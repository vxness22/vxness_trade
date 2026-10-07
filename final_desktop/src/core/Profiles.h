#pragma once
#include <QString>
#include <QStringList>

class QJsonObject;

// Named workspace profiles — File > Profile > Save Profile / Load Profile.
//
// Config already persists ONE implicit workspace: the grid, the market-watch
// setup, the fonts, where the window was. That is the state the terminal comes
// back in, and it is overwritten continuously as the trader works. A profile is
// a named copy of the same thing, taken on demand and only ever restored on
// demand — so a desk can keep a "Scalping" four-chart grid and a "Swing" single
// chart and move between them without rebuilding either.
//
// They live in their own file (profiles.json beside config.json) rather than
// inside config.json. Two reasons: config.json is written on nearly every
// interaction, and a profile must not be at risk from that; and a profile is
// portable — a trader can hand the file to a colleague, which is not true of a
// config holding their session tokens.
//
// Chart contents (timeframe, indicators, drawings) are NOT reconstructed from
// fields here. They are the charting library's own serialised state, one opaque
// string per pane, captured through ChartBridge::chartState().
struct WorkspaceProfile {
    QString name;

    // ── charts ──
    int         chartCount = 1;      // 1..4
    QStringList chartSymbols;        // per visible pane, left to right
    QStringList chartStates;         // ditto: library state per pane

    // ── window and panel arrangement ──
    QString windowGeometry;          // base64 QWidget::saveGeometry()
    QString bodySplit;               // base64 QSplitter::saveState()
    QString centerSplit;
    bool    tradePanelVisible = true;
    bool    marketWatchVisible = true;
    bool    dataWindow = false;

    // ── Market Watch ──
    QStringList watchHiddenColumns;
    QStringList watchFavourites;
    QStringList watchHiddenSymbols;
    QStringList watchSymbolColours;
    bool        watchGrid = true;

    // ── appearance and the one-click strip ──
    QString theme = QStringLiteral("light");
    QString tableFontFamily = QStringLiteral("Tahoma");
    int     tableFontSize   = 12;
    double  ticketPosX = -1.0;
    double  ticketPosY = -1.0;

    QJsonObject toJson() const;
    static WorkspaceProfile fromJson(const QString& name, const QJsonObject& o);
};

namespace Profiles {

QString filePath();                  // resolved profiles.json location

// Saved profile names, case-insensitively sorted. Also the order the Load
// Profile submenu is built in.
QStringList names();

bool exists(const QString& name);
bool load(const QString& name, WorkspaceProfile* out);
// Writes, replacing any profile of the same name. Returns false only if the
// file could not be written.
bool save(const WorkspaceProfile& p);
bool remove(const QString& name);

// The profile last loaded or saved, so the menu can mark it. Empty when the
// trader has never used one — the terminal is then on its implicit workspace
// and no entry is checked.
QString lastUsed();
void    setLastUsed(const QString& name);

}  // namespace Profiles
