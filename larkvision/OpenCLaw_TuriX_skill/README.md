# 🐾 TuriX-Mac Clawdbot Skill

This skill allows Clawdbot to control your macOS desktop visually by integrating with the **TuriX Computer Use Agent (CUA)**.

## 🚀 Overview
TuriX acts as the "eyes and hands" for Clawdbot. While Clawdbot is great at terminal and file operations, TuriX allows it to:
- Open and navigate GUI applications (Spotify, Chrome, System Settings, etc.)
- Click buttons and interact with complex UIs.
- Perform multi-step visual workflows.

It helps openclaw complete tasks automatically and makes openclaw a real digital labour!

## 📦 Installation & Setup

### 1. TuriX Core Setup
Set up TuriX following the official repository:
`https://github.com/TurixAI/TuriX-CUA`

```bash
conda activate your_env
pip install -r requirements.txt
```

### 2. Mandatory Permissions
macOS security requires explicit permission for background processes to capture the screen.

#### 2.1 Screen Recording
Go to **System Settings > Privacy & Security > Screen Recording**, then add and enable the following:

- **Terminal**
- **VS Code**
- The **Node.js binary** that is running Clawdbot, for example:  
  `/opt/homebrew/bin/node`

Make sure the toggle for each item is **ON**.

#### 2.2 Accessibility
Go to **System Settings > Privacy & Security > Accessibility**, then grant access to the tools used by Clawdbot and TuriX.

Recommended entries:

- **Terminal**
- **VS Code**
- **Node**
- `/usr/bin/python3`

If you need to manually add a system-level helper or binary, follow these steps:

1. Open **System Settings**.
2. Go to **Privacy & Security**.
3. Scroll down and open **Accessibility**.
4. Click the **+** button at the bottom of the app list.
5. macOS may ask for your account password.
6. In the file picker, press **Command + Shift + G**.
7. Paste the target path and press Enter. Example:
```
/usr/libexec/sshd-keygen-wrapper
```
8. Select the file, click **Open**, and make sure its toggle is **ON**.

This manual path-entry method is useful when the executable does not appear in the default application list.

### 3. Skill Configuration
The skill uses a helper script to bridge Clawdbot and TuriX.
- **Helper Script:** `scripts/run_turix.sh`
- **Skill Definition:** `SKILL.md`

## 🛠 Usage

In your:

```bash
your_dir/clawd/skills/local/turix-mac
```

Put the files in this structure:

```
your_dir/clawd/skills/local/turix-mac/
├── README.md
├── SKILL.md
└── scripts/
    └── run_turix.sh
```

You can trigger this skill by asking Clawdbot to perform visual tasks:
> "Use Safari to go to turix.ai, and sign up with Google account."

Clawdbot will execute the following in the background:
```bash
your_dir/clawd/skills/local/turix-mac/scripts/run_turix.sh
```

## 🔍 Troubleshooting
- **`AttributeError: 'NoneType' object has no attribute 'save'`**: This usually means screen capture failed. In most cases, this is fixed by adding the Node.js binary to **Screen Recording** permissions and then running:
```bash
openclaw gateway restart
```

- **`screencapture: command not found`**: The script includes a `PATH` export to mitigate this, but you should still ensure `/usr/sbin` is accessible in the runtime environment.

- **Permissions not sticking**: Remove the application or binary from **Screen Recording** or **Accessibility**, add it again, and ensure the toggle is enabled.

- **Binary not visible in the picker**: Use **Command + Shift + G** in the file picker and paste the full binary path manually.

- **Still cannot control the UI**: Double-check that both **Screen Recording** and **Accessibility** permissions are enabled for every process involved, especially **Terminal**, **VS Code**, **node**, and **python3**.
