## Which file do I need?

Download **one** file for your computer:

| Your computer | Download |
|---|---|
| **Windows 10 or 11** (recommended for most users) | [Pedimap2-{{VERSION}}-Windows-Installer.exe](https://github.com/Fresnedo-Lab/pedimap2/releases/download/v{{VERSION}}/Pedimap2-{{VERSION}}-Windows-Installer.exe) |
| Windows, installed for you by an IT department | [Pedimap2-{{VERSION}}-Windows.msi](https://github.com/Fresnedo-Lab/pedimap2/releases/download/v{{VERSION}}/Pedimap2-{{VERSION}}-Windows.msi) |
| **Mac with Apple Silicon** (M1, M2, M3, M4 or later) | [Pedimap2-{{VERSION}}-macOS-AppleSilicon.dmg](https://github.com/Fresnedo-Lab/pedimap2/releases/download/v{{VERSION}}/Pedimap2-{{VERSION}}-macOS-AppleSilicon.dmg) |
| **Mac with an Intel processor** | [Pedimap2-{{VERSION}}-macOS-Intel.dmg](https://github.com/Fresnedo-Lab/pedimap2/releases/download/v{{VERSION}}/Pedimap2-{{VERSION}}-macOS-Intel.dmg) |
| **Linux** (any distribution) | [Pedimap2-{{VERSION}}-Linux-x86_64.AppImage](https://github.com/Fresnedo-Lab/pedimap2/releases/download/v{{VERSION}}/Pedimap2-{{VERSION}}-Linux-x86_64.AppImage) |
| Linux: Debian or Ubuntu package | [Pedimap2-{{VERSION}}-Linux-x86_64.deb](https://github.com/Fresnedo-Lab/pedimap2/releases/download/v{{VERSION}}/Pedimap2-{{VERSION}}-Linux-x86_64.deb) |
| Linux: Fedora, RHEL or openSUSE package | [Pedimap2-{{VERSION}}-Linux-x86_64.rpm](https://github.com/Fresnedo-Lab/pedimap2/releases/download/v{{VERSION}}/Pedimap2-{{VERSION}}-Linux-x86_64.rpm) |
| User manual (PDF, all platforms) | [Pedimap2-{{VERSION}}-User-Manual.pdf](https://github.com/Fresnedo-Lab/pedimap2/releases/download/v{{VERSION}}/Pedimap2-{{VERSION}}-User-Manual.pdf) |

### Does my Mac have Apple Silicon or Intel?

Click the Apple logo in the top-left corner of the screen and choose **About This Mac**.

- If you see **Chip** (for example "Apple M2"), download the **Apple Silicon** file.
- If you see **Processor** with "Intel" in it, download the **Intel** file.

### Opening Pedimap 2 on a Mac for the first time

If macOS says Pedimap 2 "cannot be opened" or "cannot be verified", the
build is not signed by Apple. To open it anyway:

1. Drag Pedimap 2 from the disk image into your **Applications** folder.
2. In Applications, **right-click** (or Control-click) Pedimap 2 and choose **Open**.
3. Click **Open** in the dialog that appears. You only need to do this once.

On macOS 15 (Sequoia) and later, if there is no **Open** button: try to open
the app once, then go to **System Settings > Privacy & Security**, scroll
down, and click **Open Anyway** next to the Pedimap 2 message.

### Running the Linux AppImage

Make the file executable once, then double-click it or run it from a terminal:
`chmod +x Pedimap2-{{VERSION}}-Linux-x86_64.AppImage`

### Files you can ignore

- `Pedimap2-{{VERSION}}-macOS-*-update.app.tar.gz`, their `.sig` files, and
  `latest.json` are used **only by automatic updates**. Do not download them
  to install Pedimap 2.
- `SHA256SUMS.txt` lists a checksum for every file, so you can confirm a
  download is complete and unmodified.

## What's new

{{WHATS_NEW}}

Full history: [CHANGELOG.md](https://github.com/Fresnedo-Lab/pedimap2/blob/v{{VERSION}}/CHANGELOG.md)
