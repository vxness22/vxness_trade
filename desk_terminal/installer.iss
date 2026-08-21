; Inno Setup script — packages the built Vxness Terminal into a single
; VxnessTerminal-Setup.exe installer. Installs per-user (no admin / no UAC).
;
; Paths are relative to this script ({#SourcePath}) rather than absolute: the
; previous version hard-coded "D:\setupfx codes\trading terminal", which broke
; the moment the repo was cloned anywhere else.
#define MyApp "Vxness Terminal"
#define MyExe "terminal.exe"
#define BuildDir SourcePath + "build-msvc"

[Setup]
; A FRESH AppId. This build shares a code lineage with other brokers' desktop
; terminals; keeping one of their AppIds would make the Vxness installer
; overwrite an existing install of one of them and take over its Apps &
; features entry, on a machine whose owner may still trade there.
;
; KNOWN CONSEQUENCE: the VxnessTerminal-Setup.exe published in July 2025 was
; built elsewhere and its AppId could not be recovered from the compressed
; installer. Anyone who installed that build will get a SECOND "Vxness
; Terminal" entry rather than an in-place upgrade, and should uninstall the old
; one manually. From this release onward upgrades are in place — so once
; published, do NOT change this GUID again.
AppId={{77A56844-D704-463B-89ED-115A5A224749}
AppName={#MyApp}
; Keep in step with FILEVERSION/PRODUCTVERSION in resources/app.rc and
; TX_VERSION in CMakeLists.txt. The download FILENAME is deliberately
; unversioned (see OutputBaseFilename), so bumping this does not require
; touching the website link — only the ?v= cache-buster on it
; (frontend/src/website/src/components/desktop-terminal-download.jsx).
AppVersion=1.1.5
AppPublisher=Vxness
DefaultDirName={autopf}\Vxness Terminal
DefaultGroupName=Vxness Terminal
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyExe}
OutputDir={#SourcePath}dist
; UNVERSIONED on purpose. The site links to
;   https://vxness.in/downloads/VxnessTerminal-Setup.exe
; and nginx serves that path straight off disk, so a versioned filename would
; break the download button on every release until someone edited the navbar.
; The version still travels inside the installer (AppVersion above) and in the
; executable's own version info (resources/app.rc).
OutputBaseFilename=VxnessTerminal-Setup
SetupIconFile={#SourcePath}resources\vxness.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

; Code signing, when make-installer.ps1 was given a certificate (it passes
; /DSIGN and the tool itself on the ISCC command line).
;
; Declared behind #ifdef on purpose: naming a SignTool that ISCC has not been
; given aborts the compile, and a developer building an unsigned test installer
; has no certificate. SignedUninstaller covers the one file that cannot be
; signed from outside — the uninstaller is generated on the trader's machine
; during the install, so Inno has to sign it as it builds it in.
#ifdef SIGN
SignTool=signtool
SignedUninstaller=yes
#endif

; ── Installing over a RUNNING terminal ───────────────────────────────
; Symptom this fixes:
;     resources\icudtl.dat
;     DeleteFile failed; code 32.
;     The process cannot access the file because it is being used by
;     another process.
;
; Inno already asks Restart Manager to close whatever holds the files it
; is about to replace, but CloseApplicationsFilter defaults to
; *.exe,*.dll,*.chm — and the files QtWebEngine keeps mapped are none of
; those. icudtl.dat, qtwebengine_resources*.pak and v8_context_snapshot.bin
; were never registered, so nothing was detected, the install ran, and it
; died partway through on the first locked one. Widening the filter to
; every file is what actually makes the detection cover them. It costs a
; slower "Preparing to install" scan; a half-installed terminal costs more.
CloseApplications=yes
CloseApplicationsFilter=*.*
; Don't relaunch what we closed — [Run] below already offers to start it,
; and reopening it silently mid-install races the file copy.
RestartApplications=no
; Belt and braces: the app holds this mutex while it runs (see src/main.cpp),
; so Setup can say "close Vxness Terminal" up front instead of relying on
; Restart Manager alone. Renaming it breaks that detection on installed
; versions, so leave it alone.
AppMutex=VxnessTerminal.SingleInstance
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
; ignoreversion is NOT optional here.
;
; Inno's default for a file carrying version info is to replace it only when
; the incoming version is HIGHER. terminal.exe declares its version from
; resources/app.rc, and that had been left at 1.0.1 across builds — so an
; upgrade compared 1.0.1 against 1.0.1, decided there was nothing to do, and
; skipped the executable. Setup still wrote the uninstaller and stamped
; DisplayVersion=1.0.2 into Apps & features, which is the worst possible
; outcome: the machine reports 1.0.2 while running the older binary, and the
; only symptom is "my changes aren't there".
;
; app.rc is bumped alongside AppVersion now, but this flag is the belt to that
; brace — a build where someone forgets to bump still ships, because the file
; is replaced on every install regardless of what its version claims.
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; \
  Excludes: "CMakeFiles\*,terminal_autogen\*,*.obj,*.pdb,*.ilk,*.cmake,CMakeCache.txt,build.ninja,.ninja_deps,.ninja_log,*.ninja_deps,*.ninja_log,chart-diag.log"

[Icons]
Name: "{group}\Vxness Terminal"; Filename: "{app}\{#MyExe}"
Name: "{autodesktop}\Vxness Terminal"; Filename: "{app}\{#MyExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyExe}"; Description: "Launch Vxness Terminal"; Flags: nowait postinstall skipifsilent
