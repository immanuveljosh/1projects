package chat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"officechat/backend/internal/db"
	"officechat/backend/internal/models"
	"officechat/backend/internal/ws"
)

var (
	ErrPollNotFound = errors.New("poll not found")
	ErrPollClosed   = errors.New("poll is already closed")
)

type PollService struct {
	db  *db.DB
	hub *ws.Hub
}

func NewPollService(database *db.DB, hub *ws.Hub) *PollService {
	return &PollService{db: database, hub: hub}
}

// CreatePoll creates a new poll and its options, broadcasting to workspace
func (s *PollService) CreatePoll(ctx context.Context, userID string, req models.CreatePollRequest) (*models.PollSummary, error) {
	req.Question = strings.TrimSpace(req.Question)
	if req.Question == "" {
		return nil, errors.New("poll question is required")
	}
	if len(req.Options) < 2 {
		return nil, errors.New("at least two options are required")
	}

	// Resolve workspace_id from channel_id or dm_group_id
	var workspaceID string
	if req.ChannelID != nil && *req.ChannelID != "" {
		_ = s.db.QueryRowContext(ctx, `SELECT workspace_id FROM channels WHERE id = $1`, *req.ChannelID).Scan(&workspaceID)
	} else if req.DMGroupID != nil && *req.DMGroupID != "" {
		_ = s.db.QueryRowContext(ctx, `SELECT workspace_id FROM direct_message_groups WHERE id = $1`, *req.DMGroupID).Scan(&workspaceID)
	}

	var pollID string
	err := s.db.WithTransaction(ctx, func(tx *sql.Tx) error {
		query := `
			INSERT INTO polls (message_id, channel_id, dm_group_id, question, is_closed, created_by, created_at)
			VALUES ($1, $2, $3, $4, FALSE, $5, NOW())
			RETURNING id;
		`
		if err := tx.QueryRowContext(ctx, query, req.MessageID, req.ChannelID, req.DMGroupID, req.Question, userID).Scan(&pollID); err != nil {
			return fmt.Errorf("failed creating poll: %w", err)
		}

		for idx, optText := range req.Options {
			optText = strings.TrimSpace(optText)
			if optText == "" {
				continue
			}
			_, err := tx.ExecContext(ctx, `
				INSERT INTO poll_options (poll_id, option_text, order_index)
				VALUES ($1, $2, $3);
			`, pollID, optText, idx)
			if err != nil {
				return fmt.Errorf("failed creating poll option: %w", err)
			}
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	summary, err := s.GetPoll(ctx, pollID, userID)
	if err != nil {
		return nil, err
	}

	if s.hub != nil && workspaceID != "" {
		s.hub.BroadcastToWorkspace(workspaceID, "poll.created", summary)
	}

	return summary, nil
}

// GetPoll returns poll summary with options, vote counts, and user's voted option
func (s *PollService) GetPoll(ctx context.Context, pollID, currentUserID string) (*models.PollSummary, error) {
	var poll models.Poll
	query := `
		SELECT id, message_id, channel_id, dm_group_id, question, is_closed, created_by, created_at, closed_at
		FROM polls
		WHERE id = $1;
	`
	err := s.db.QueryRowContext(ctx, query, pollID).Scan(
		&poll.ID, &poll.MessageID, &poll.ChannelID, &poll.DMGroupID,
		&poll.Question, &poll.IsClosed, &poll.CreatedBy, &poll.CreatedAt, &poll.ClosedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPollNotFound
		}
		return nil, err
	}

	// Fetch creator profile
	var creator models.UserResponse
	_ = s.db.QueryRowContext(ctx, `
		SELECT id, email, full_name, COALESCE(display_name, ''), COALESCE(avatar_url, ''),
		       role, COALESCE(department, ''), COALESCE(account_state, 'active'),
		       must_change_password, status, COALESCE(custom_status, ''), created_at
		FROM users WHERE id = $1;
	`, poll.CreatedBy).Scan(
		&creator.ID, &creator.Email, &creator.FullName, &creator.DisplayName, &creator.AvatarURL,
		&creator.Role, &creator.Department, &creator.AccountState,
		&creator.MustChangePassword, &creator.Status, &creator.CustomStatus, &creator.CreatedAt,
	)

	// Fetch options with vote count
	optRows, err := s.db.QueryContext(ctx, `
		SELECT po.id, po.option_text, po.order_index,
		       (SELECT COUNT(*) FROM poll_votes pv WHERE pv.option_id = po.id) as vote_count
		FROM poll_options po
		WHERE po.poll_id = $1
		ORDER BY po.order_index ASC;
	`, pollID)
	if err != nil {
		return nil, fmt.Errorf("failed querying poll options: %w", err)
	}
	defer optRows.Close()

	var options []models.PollOptionSummary
	totalVotes := 0
	for optRows.Next() {
		var opt models.PollOptionSummary
		if err := optRows.Scan(&opt.ID, &opt.OptionText, &opt.OrderIndex, &opt.VoteCount); err == nil {
			options = append(options, opt)
			totalVotes += opt.VoteCount
		}
	}
	if err := optRows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating poll options: %w", err)
	}
	if options == nil {
		options = []models.PollOptionSummary{}
	}

	// Check if current user voted
	var userVotedID *string
	var votedOptID string
	err = s.db.QueryRowContext(ctx, `
		SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2
	`, pollID, currentUserID).Scan(&votedOptID)
	if err == nil && votedOptID != "" {
		userVotedID = &votedOptID
	}

	return &models.PollSummary{
		ID:          poll.ID,
		Question:    poll.Question,
		IsClosed:    poll.IsClosed,
		CreatedBy:   poll.CreatedBy,
		TotalVotes:  totalVotes,
		Options:     options,
		UserVotedID: userVotedID,
		Creator:     &creator,
	}, nil
}

// VotePoll records or changes user's vote
func (s *PollService) VotePoll(ctx context.Context, pollID, optionID, userID string) (*models.PollSummary, error) {
	var isClosed bool
	var channelID, dmGroupID *string
	err := s.db.QueryRowContext(ctx, `SELECT is_closed, channel_id, dm_group_id FROM polls WHERE id = $1`, pollID).Scan(&isClosed, &channelID, &dmGroupID)
	if err != nil {
		return nil, ErrPollNotFound
	}
	if isClosed {
		return nil, ErrPollClosed
	}

	query := `
		INSERT INTO poll_votes (poll_id, option_id, user_id, created_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, created_at = NOW();
	`
	if _, err := s.db.ExecContext(ctx, query, pollID, optionID, userID); err != nil {
		return nil, fmt.Errorf("failed casting vote: %w", err)
	}

	summary, err := s.GetPoll(ctx, pollID, userID)
	if err != nil {
		return nil, err
	}

	var workspaceID string
	if channelID != nil {
		_ = s.db.QueryRowContext(ctx, `SELECT workspace_id FROM channels WHERE id = $1`, *channelID).Scan(&workspaceID)
	} else if dmGroupID != nil {
		_ = s.db.QueryRowContext(ctx, `SELECT workspace_id FROM direct_message_groups WHERE id = $1`, *dmGroupID).Scan(&workspaceID)
	}

	if s.hub != nil && workspaceID != "" {
		s.hub.BroadcastToWorkspace(workspaceID, "poll.voted", summary)
	}

	return summary, nil
}

// ClosePoll marks poll closed
func (s *PollService) ClosePoll(ctx context.Context, pollID, userID string) (*models.PollSummary, error) {
	var createdBy string
	var channelID, dmGroupID *string
	err := s.db.QueryRowContext(ctx, `SELECT created_by, channel_id, dm_group_id FROM polls WHERE id = $1`, pollID).Scan(&createdBy, &channelID, &dmGroupID)
	if err != nil {
		return nil, ErrPollNotFound
	}

	// Only creator can close poll
	if createdBy != userID {
		return nil, errors.New("only poll creator can close the poll")
	}

	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `UPDATE polls SET is_closed = TRUE, closed_at = $1 WHERE id = $2`, now, pollID)
	if err != nil {
		return nil, fmt.Errorf("failed to close poll: %w", err)
	}

	summary, err := s.GetPoll(ctx, pollID, userID)
	if err != nil {
		return nil, err
	}

	var workspaceID string
	if channelID != nil {
		_ = s.db.QueryRowContext(ctx, `SELECT workspace_id FROM channels WHERE id = $1`, *channelID).Scan(&workspaceID)
	} else if dmGroupID != nil {
		_ = s.db.QueryRowContext(ctx, `SELECT workspace_id FROM direct_message_groups WHERE id = $1`, *dmGroupID).Scan(&workspaceID)
	}

	if s.hub != nil && workspaceID != "" {
		s.hub.BroadcastToWorkspace(workspaceID, "poll.closed", summary)
	}

	return summary, nil
}
