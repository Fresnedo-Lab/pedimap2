# Chapter 2 — Installation

Pedimap 2 is a single download: everything it needs is included. You do not
need to install Python or any other software first.

## Which file to download

Go to the latest release:
<https://github.com/Fresnedo-Lab/pedimap2/releases/latest>

Download **one** file for your computer (`X.Y.Z` is the version number):

| Your computer | File |
|------------------------|--------------------|
| Windows 10 or 11 (recommended for most users) | `Pedimap2-X.Y.Z-Windows-Installer.exe` |
| Windows, installed for you by an IT department | `Pedimap2-X.Y.Z-Windows.msi` |
| Mac with Apple silicon (M1, M2, M3, M4 or later) | `Pedimap2-X.Y.Z-macOS-AppleSilicon.dmg` |
| Mac with an Intel processor | `Pedimap2-X.Y.Z-macOS-Intel.dmg` |
| Linux (any distribution) | `Pedimap2-X.Y.Z-Linux-x86_64.AppImage` |
| Linux, Debian or Ubuntu package | `Pedimap2-X.Y.Z-Linux-x86_64.deb` |
| Linux, Fedora, RHEL or openSUSE package | `Pedimap2-X.Y.Z-Linux-x86_64.rpm` |

The release page shows the same table with direct links. It also offers
this manual as a PDF.

You can ignore the files ending in `-update.app.tar.gz`, `.sig` and
`latest.json`: Pedimap uses them for its automatic updates.
`SHA256SUMS.txt` lets you check that a download is complete.

**Apple silicon or Intel?** Click the Apple menu at the top left of the
screen and choose **About This Mac**. If it shows **Chip** (for example
"Apple M2"), take the Apple silicon file; if it shows **Processor** with
"Intel" in it, take the Intel file.

## macOS

Pedimap 2 needs macOS 10.15 (Catalina) or later.

1. Open the downloaded `.dmg` file.
2. Drag **Pedimap 2** into the **Applications** folder.
3. Open Pedimap 2 from Applications.

Pedimap 2 is signed and notarized by Apple. If macOS still says that it
cannot be opened or verified, right-click the app in Applications and
choose **Open**. On macOS 15 (Sequoia) and later, open **System Settings →
Privacy & Security** instead, and click **Open Anyway** next to the message
about Pedimap 2.

## Windows

Pedimap 2 runs on Windows 10 and 11.

1. Run the downloaded `Pedimap2-X.Y.Z-Windows-Installer.exe`.
2. If Windows shows a blue "Windows protected your PC" window, click
   **More info**, then **Run anyway**.
3. Follow the installer. Pedimap 2 appears in the Start menu.

The `.msi` file installs the same program, in the way IT departments
usually deploy software.

## Linux

**AppImage** (any distribution): mark the file as executable once, then run
it.

```bash
chmod +x Pedimap2-*-Linux-x86_64.AppImage
./Pedimap2-*-Linux-x86_64.AppImage
```

**Debian or Ubuntu:** install the package with your software center, or
with `sudo apt install ./Pedimap2-X.Y.Z-Linux-x86_64.deb`.

**Fedora, RHEL or openSUSE:** install the package with your software center,
or with `sudo dnf install ./Pedimap2-X.Y.Z-Linux-x86_64.rpm` (on openSUSE,
`sudo zypper install`).

## The first start

Pedimap 2 starts a small calculation service of its own in the background.
For a few seconds the window says "Starting Pedimap backend…"; then it
shows a small made-up demo pedigree, "Apple Breeding Program – Demo". You
can open your own file at once (see [Chapter 3](03_quickstart.md)).

If the window keeps saying **Cannot reach the Pedimap backend service**,
click **Retry**. If that does not help, see
[Chapter 9](09_faq.md).

## Updating

Pedimap 2 looks for a new version each time it starts. When one is out, a
bar appears below the toolbar: "Pedimap 2 vX.Y.Z is available (you have
vX.Y.Z)". Click **Install and restart**; Pedimap downloads the new version,
installs it and starts again. To look for an update yourself, click
**About** at the top right of the window, then **Check for updates**.

On Linux, the AppImage updates itself in the same way. If you installed the
`.deb` or `.rpm` package and Pedimap does not offer an update, download and
install the new package from the release page.

## Which version do I have?

Click **About** at the top right of the window. It shows the version
number; please include it when you report a problem.
