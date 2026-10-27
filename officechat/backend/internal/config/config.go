package config

import (
	"bufio"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port               string
	Env                string
	AppName            string
	AppURL             string
	ClientURL          string
	DBHost             string
	DBPort             string
	DBUser             string
	DBPassword         string
	DBName             string
	DBSSLMode          string
	DatabaseURL        string
	RedisHost          string
	RedisPort          string
	RedisPassword      string
	RedisURL           string
	MinioEndpoint      string
	MinioPublicEndpoint string
	MinioAccessKey     string
	MinioSecretKey     string
	MinioBucket        string
	MinioUseSSL        bool
	MinioRegion        string
	JWTAccessSecret    string
	JWTRefreshSecret   string
	JWTAccessExpiry    time.Duration
	JWTRefreshExpiry   time.Duration
	CORSAllowedOrigins []string
	MaxFileSizeMB      int64
	VirusScanEnabled   bool
	VirusScanMock      bool
}

func Load() *Config {
	loadDotEnv()

	port := getEnv("PORT", "8080")
	env := getEnv("ENV", "development")
	appName := getEnv("APP_NAME", "OfficeChat")
	appURL := getEnv("APP_URL", "http://localhost:8080")
	clientURL := getEnv("CLIENT_URL", "http://localhost:3000")

	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "officechat")
	dbPass := getEnv("DB_PASSWORD", "officechat_secret")
	dbName := getEnv("DB_NAME", "officechat_db")
	dbSSL := getEnv("DB_SSLMODE", "disable")

	dbURL := getEnv("DATABASE_URL", "")
	if dbURL == "" {
		dbURL = "postgres://" + dbUser + ":" + dbPass + "@" + dbHost + ":" + dbPort + "/" + dbName + "?sslmode=" + dbSSL
	}

	redisHost := getEnv("REDIS_HOST", "localhost")
	redisPort := getEnv("REDIS_PORT", "6379")
	redisPass := getEnv("REDIS_PASSWORD", "")
	redisURL := getEnv("REDIS_URL", "")
	if redisURL == "" {
		if redisPass != "" {
			redisURL = "redis://:" + redisPass + "@" + redisHost + ":" + redisPort + "/0"
		} else {
			redisURL = "redis://" + redisHost + ":" + redisPort + "/0"
		}
	}

	minioEndpoint := getEnv("MINIO_ENDPOINT", "localhost:9000")
	minioPublicEndpoint := getEnv("MINIO_PUBLIC_ENDPOINT", "http://localhost:9000")
	minioAccessKey := getEnv("MINIO_ACCESS_KEY", "minioadmin")
	minioSecretKey := getEnv("MINIO_SECRET_KEY", "minioadmin")
	minioBucket := getEnv("MINIO_BUCKET", "officechat-files")
	minioUseSSL := getEnvAsBool("MINIO_USE_SSL", false)
	minioRegion := getEnv("MINIO_REGION", "us-east-1")

	jwtAccessSecret := getEnv("JWT_ACCESS_SECRET", "officechat_access_token_secret_32bytes_min_length!")
	jwtRefreshSecret := getEnv("JWT_REFRESH_SECRET", "officechat_refresh_token_secret_32bytes_min_length!")
	jwtAccessExpiry := getEnvAsDuration("JWT_ACCESS_EXPIRY", 15*time.Minute)
	jwtRefreshExpiry := getEnvAsDuration("JWT_REFRESH_EXPIRY", 7*24*time.Hour)

	corsOriginsStr := getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173")
	var corsOrigins []string
	for _, o := range strings.Split(corsOriginsStr, ",") {
		trimmed := strings.TrimSpace(o)
		if trimmed != "" {
			corsOrigins = append(corsOrigins, trimmed)
		}
	}

	maxFileSizeMB := getEnvAsInt64("MAX_FILE_SIZE_MB", 25)
	virusScanEnabled := getEnvAsBool("VIRUS_SCAN_ENABLED", true)
	virusScanMock := getEnvAsBool("VIRUS_SCAN_MOCK", true)

	return &Config{
		Port:               port,
		Env:                env,
		AppName:            appName,
		AppURL:             appURL,
		ClientURL:          clientURL,
		DBHost:             dbHost,
		DBPort:             dbPort,
		DBUser:             dbUser,
		DBPassword:         dbPass,
		DBName:             dbName,
		DBSSLMode:          dbSSL,
		DatabaseURL:        dbURL,
		RedisHost:          redisHost,
		RedisPort:          redisPort,
		RedisPassword:      redisPass,
		RedisURL:           redisURL,
		MinioEndpoint:      minioEndpoint,
		MinioPublicEndpoint: minioPublicEndpoint,
		MinioAccessKey:     minioAccessKey,
		MinioSecretKey:     minioSecretKey,
		MinioBucket:        minioBucket,
		MinioUseSSL:        minioUseSSL,
		MinioRegion:        minioRegion,
		JWTAccessSecret:    jwtAccessSecret,
		JWTRefreshSecret:   jwtRefreshSecret,
		JWTAccessExpiry:    jwtAccessExpiry,
		JWTRefreshExpiry:   jwtRefreshExpiry,
		CORSAllowedOrigins: corsOrigins,
		MaxFileSizeMB:      maxFileSizeMB,
		VirusScanEnabled:   virusScanEnabled,
		VirusScanMock:      virusScanMock,
	}
}

func getEnv(key, defaultVal string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return defaultVal
}

func getEnvAsBool(key string, defaultVal bool) bool {
	valStr := getEnv(key, "")
	if val, err := strconv.ParseBool(valStr); err == nil {
		return val
	}
	return defaultVal
}

func getEnvAsInt64(key string, defaultVal int64) int64 {
	valStr := getEnv(key, "")
	if val, err := strconv.ParseInt(valStr, 10, 64); err == nil {
		return val
	}
	return defaultVal
}

func getEnvAsDuration(key string, defaultVal time.Duration) time.Duration {
	valStr := getEnv(key, "")
	if val, err := time.ParseDuration(valStr); err == nil {
		return val
	}
	return defaultVal
}

func loadDotEnv() {
	paths := []string{".env", "../.env", "../../.env"}
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				k := strings.TrimSpace(parts[0])
				v := strings.TrimSpace(parts[1])
				// remove surrounding quotes if any
				if len(v) >= 2 && ((v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'')) {
					v = v[1 : len(v)-1]
				}
				if _, exists := os.LookupEnv(k); !exists {
					_ = os.Setenv(k, v)
				}
			}
		}
		if err := scanner.Err(); err != nil {
			log.Printf("[CONFIG] Error reading %s: %v", p, err)
		}
		break
	}
}
