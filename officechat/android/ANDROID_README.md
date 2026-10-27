# OfficeChat Android Studio App

This directory (`/officechat/android`) is a native Android Studio project engineered for running OfficeChat on Android devices and emulators.

---

## 🛠️ Project Configuration
- **Application ID**: `com.officechat.android`
- **Compile SDK**: `34` (Android 14)
- **Min SDK**: `26` (Android 8.0 Oreo)
- **Architecture**: Kotlin + AndroidX + Material 3 + ViewBinding + WebKit
- **SDK Path**: Preconfigured in `local.properties` to `C:\Users\Immanuel\AppData\Local\Android\Sdk`

---

## 🚀 How to Run in Android Studio

1. **Open Project**:
   - Android Studio has been launched with `d:\1projects\officechat\android`.
   - If opening manually: Open Android Studio -> **File -> Open...** -> select `d:\1projects\officechat\android`.

2. **Gradle Sync**:
   - Wait for Android Studio to finish indexing and syncing the Gradle project.

3. **Select Target Device**:
   - In the top toolbar device selector, choose your connected physical device (`863d005830483132385115e8f99b9c`) or an Android Virtual Device (AVD Emulator).

4. **Click Run (`Shift + F10` or ▶️)**:
   - Android Studio will compile the app and install it on the device.

---

## 🌐 Local Network & USB Connectivity

The app is preconfigured to connect seamlessly to your local development environment:

1. **Physical Phone via USB (with ADB reverse)**:
   - Run in terminal:
     ```bash
     adb reverse tcp:3000 tcp:3000
     adb reverse tcp:8080 tcp:8080
     ```
   - The app connects to `http://localhost:3000` transparently over USB.

2. **Android Virtual Device (Emulator)**:
   - The app automatically detects the emulator and routes to `http://10.0.2.2:3000`.

3. **Wi-Fi LAN**:
   - If connected on the same Wi-Fi network, tap **Server Settings** on the error/settings screen and enter your PC IP:
     `http://192.168.1.45:3000`

---

## 📱 Features Included in the Android App
- **Responsive Workspace Chat**: Full team channels, DMs, rich messages, and tasks.
- **Admin Console**: Access the enterprise Admin Console when logged in as Owner or Admin.
- **File & Camera Attachments**: Native file chooser integration (`WebChromeClient.onShowFileChooser`) allowing image and document uploads directly from Android storage or camera.
- **Pull-to-Refresh**: Modern `SwipeRefreshLayout` support.
- **Offline & Reconnection Handling**: Error states with one-tap Retry and customizable Server URL dialog.
- **Back Button Handling**: Natural Android system back button navigation through channel history.
