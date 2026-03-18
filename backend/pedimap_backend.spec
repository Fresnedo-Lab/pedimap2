# pedimap_backend.spec
# =====================
# PyInstaller spec for bundling the FastAPI backend into a standalone binary.
#
# Usage (run from backend/ directory):
#   pyinstaller pedimap_backend.spec
#
# The resulting binary ends up in dist/pedimap-backend[.exe]
# It must then be renamed with the Tauri target triple before being placed
# in src-tauri/binaries/ — see build_sidecar.sh / build_sidecar.ps1.
#
# Target triple examples:
#   Windows x86_64   pedimap-backend-x86_64-pc-windows-msvc.exe
#   macOS arm64      pedimap-backend-aarch64-apple-darwin
#   macOS x86_64     pedimap-backend-x86_64-apple-darwin
#   Linux x86_64     pedimap-backend-x86_64-unknown-linux-gnu

import sys
import os
from PyInstaller.utils.hooks import collect_all

# Collect all files needed by fastapi, uvicorn, networkx
datas_fastapi,   bins_fastapi,   hidden_fastapi   = collect_all("fastapi")
datas_uvicorn,   bins_uvicorn,   hidden_uvicorn   = collect_all("uvicorn")
datas_networkx,  bins_networkx,  hidden_networkx  = collect_all("networkx")
datas_starlette, bins_starlette, hidden_starlette = collect_all("starlette")
datas_anyio,     bins_anyio,     hidden_anyio     = collect_all("anyio")

block_cipher = None

a = Analysis(
    ['api.py'],
    pathex=['.'],
    binaries=bins_fastapi + bins_uvicorn + bins_networkx + bins_starlette + bins_anyio,
    datas=(
        datas_fastapi
        + datas_uvicorn
        + datas_networkx
        + datas_starlette
        + datas_anyio
        + [('pedigree_engine.py', '.')]
        + [('sample_data.py', '.')]
        + [('pmp_parser.py', '.')] if os.path.exists('pmp_parser.py') else []
    ),
    hiddenimports=(
        hidden_fastapi
        + hidden_uvicorn
        + hidden_networkx
        + hidden_starlette
        + hidden_anyio
        + [
            'uvicorn.logging',
            'uvicorn.loops',
            'uvicorn.loops.auto',
            'uvicorn.loops.asyncio',
            'uvicorn.loops.uvloop',
            'uvicorn.protocols',
            'uvicorn.protocols.http',
            'uvicorn.protocols.http.auto',
            'uvicorn.protocols.http.h11_impl',
            'uvicorn.protocols.http.httptools_impl',
            'uvicorn.protocols.websockets',
            'uvicorn.protocols.websockets.auto',
            'uvicorn.lifespan',
            'uvicorn.lifespan.on',
            'uvicorn.lifespan.off',
            'anyio',
            'anyio._backends._asyncio',
            'h11',
            'pydantic',
            'pydantic.deprecated.class_validators',
            'email.mime.text',
            'email.mime.multipart',
        ]
    ),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'matplotlib', 'PIL', 'cv2',
        'scipy', 'pandas', 'numpy',  # not needed – keep binary small
        'IPython', 'jupyter',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='pedimap-backend',       # final binary name (without triple suffix)
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,                # no console window on Windows
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,       # set in CI for macOS notarisation
    entitlements_file=None,
    icon=None,                    # optionally point to .ico / .icns
)
