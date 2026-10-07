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
; Vxness's OWN AppId — the one every published VxnessTerminal-Setup.exe has
; carried. It must stay this value: Inno matches an existing install by AppId,
; so a different GUID does not upgrade the copy a trader already has, it
; installs a SECOND one beside it with its own Apps & features entry.
;
; This build shares a code lineage with other brokers' desktop terminals, and
; the source it was rebranded from arrived carrying THEIR AppId. That is the
; mistake this comment exists to stop: adopting another broker's GUID would
; make this installer overwrite their install and take over its uninstall
; entry. Vxness is a different platform and keeps its own.
AppId={{77A56844-D704-463B-89ED-115A5A224749}
AppName={#MyApp}
; The website's download button links to /downloads/VxnessTerminal-Setup.exe
; with a ?v= cache-buster (frontend/src/website/src/components/
; desktop-terminal-download.jsx). Publish this build's output under that name
; and bump the ?v= there with AppVersion, or browsers keep the old installer.
AppVersion=2.5.1
AppPublisher=Vxness
DefaultDirName={autopf}\Vxness Terminal
DefaultGroupName=Vxness Terminal
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyExe}
OutputDir={#SourcePath}dist
OutputBaseFilename=VxnessTerminal-Setup-2.5.1
SetupIconFile={#SourcePath}resources\vxness.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

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

; A stamp of THIS install, read by the terminal on its first launch
; (Config::applyInstallReset). A new stamp means the sign-in form starts empty:
; the config with the last email, a remembered password and a live session
; lives in the user's AppData and outlives the program files, so a terminal
; downloaded from the website used to open with credentials already filled in.
; The stamp is the install time, so even reinstalling the same setup counts.
[INI]
Filename: "{app}\install.ini"; Section: "install"; Key: "stamp"; String: "{code:InstallStamp}"
Filename: "{app}\install.ini"; Section: "install"; Key: "version"; String: "{#SetupSetting("AppVersion")}"

; Uninstalling takes the saved sign-in with it — a remembered password is kept
; in that file, and nothing of it should stay on the machine once the terminal
; is gone. AppConfigLocation for organisation "Vxness", application
; "Vxness Terminal" (src/main.cpp).
[UninstallDelete]
Type: files; Name: "{localappdata}\Vxness\Vxness Terminal\config.json"
Type: files; Name: "{app}\install.ini"

[Code]
function InstallStamp(Param: String): String;
begin
  Result := GetDateTimeString('yyyymmddhhnnsszzz', #0, #0);
end;

[Icons]
Name: "{group}\Vxness Terminal"; Filename: "{app}\{#MyExe}"
Name: "{autodesktop}\Vxness Terminal"; Filename: "{app}\{#MyExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyExe}"; Description: "Launch Vxness Terminal"; Flags: nowait postinstall skipifsilent
