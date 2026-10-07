#include "core/Profiles.h"

#include <algorithm>

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStandardPaths>

// ── file ────────────────────────────────────────────────────────────────────
//
// Shape:
//   { "lastUsed": "Scalping",
//     "profiles": { "Scalping": { …one WorkspaceProfile… }, … } }
//
// Re-read before every write, like ChartBridge's template store: the file is
// small, and holding it in memory would mean a save made from one code path
// could drop a profile another had just added.

static QString storePath() {
    QString dir = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    if (dir.isEmpty()) dir = QDir::homePath() + "/.vxness-terminal";
    QDir().mkpath(dir);
    return dir + "/profiles.json";
}

static QJsonObject readStore() {
    QFile f(storePath());
    if (!f.open(QIODevice::ReadOnly)) return {};
    return QJsonDocument::fromJson(f.readAll()).object();
}

static bool writeStore(const QJsonObject& o) {
    QFile f(storePath());
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate)) return false;
    return f.write(QJsonDocument(o).toJson(QJsonDocument::Indented)) >= 0;
}

// ── JSON helpers ────────────────────────────────────────────────────────────

static QJsonArray toArray(const QStringList& list) {
    QJsonArray a;
    for (const QString& s : list) a.append(s);
    return a;
}

static QStringList toList(const QJsonValue& v) {
    QStringList out;
    for (const QJsonValue& x : v.toArray()) out << x.toString();
    return out;
}

// ── WorkspaceProfile ────────────────────────────────────────────────────────

QJsonObject WorkspaceProfile::toJson() const {
    QJsonObject o;
    o["chartCount"]   = chartCount;
    o["chartSymbols"] = toArray(chartSymbols);
    o["chartStates"]  = toArray(chartStates);

    o["windowGeometry"]    = windowGeometry;
    o["bodySplit"]         = bodySplit;
    o["centerSplit"]       = centerSplit;
    o["tradePanelVisible"]  = tradePanelVisible;
    o["marketWatchVisible"] = marketWatchVisible;
    o["dataWindow"]         = dataWindow;

    o["watchHiddenColumns"] = toArray(watchHiddenColumns);
    o["watchFavourites"]    = toArray(watchFavourites);
    o["watchHiddenSymbols"] = toArray(watchHiddenSymbols);
    o["watchSymbolColours"] = toArray(watchSymbolColours);
    o["watchGrid"]          = watchGrid;

    o["theme"]           = theme;
    o["tableFontFamily"] = tableFontFamily;
    o["tableFontSize"]   = tableFontSize;
    o["ticketPosX"]      = ticketPosX;
    o["ticketPosY"]      = ticketPosY;
    return o;
}

WorkspaceProfile WorkspaceProfile::fromJson(const QString& name, const QJsonObject& o) {
    WorkspaceProfile p;
    p.name = name;

    // Every field falls back to the struct's own default, so a profile written
    // by an older build — or hand-edited — loads with the missing parts left
    // as they are rather than zeroed. chartCount is clamped because a bad value
    // there would reach ChartArea, which tiles 1..4 and nothing else.
    p.chartCount = qBound(1, o.value("chartCount").toInt(p.chartCount), 4);
    p.chartSymbols = toList(o.value("chartSymbols"));
    p.chartStates  = toList(o.value("chartStates"));

    p.windowGeometry    = o.value("windowGeometry").toString();
    p.bodySplit         = o.value("bodySplit").toString();
    p.centerSplit       = o.value("centerSplit").toString();
    p.tradePanelVisible  = o.value("tradePanelVisible").toBool(p.tradePanelVisible);
    p.marketWatchVisible = o.value("marketWatchVisible").toBool(p.marketWatchVisible);
    p.dataWindow         = o.value("dataWindow").toBool(p.dataWindow);

    p.watchHiddenColumns = toList(o.value("watchHiddenColumns"));
    p.watchFavourites    = toList(o.value("watchFavourites"));
    p.watchHiddenSymbols = toList(o.value("watchHiddenSymbols"));
    p.watchSymbolColours = toList(o.value("watchSymbolColours"));
    p.watchGrid          = o.value("watchGrid").toBool(p.watchGrid);

    p.theme           = o.value("theme").toString(p.theme);
    p.tableFontFamily = o.value("tableFontFamily").toString(p.tableFontFamily);
    p.tableFontSize   = o.value("tableFontSize").toInt(p.tableFontSize);
    p.ticketPosX      = o.value("ticketPosX").toDouble(p.ticketPosX);
    p.ticketPosY      = o.value("ticketPosY").toDouble(p.ticketPosY);
    return p;
}

// ── store ───────────────────────────────────────────────────────────────────

namespace Profiles {

QString filePath() { return storePath(); }

QStringList names() {
    QStringList out = readStore().value("profiles").toObject().keys();
    std::sort(out.begin(), out.end(), [](const QString& a, const QString& b) {
        return a.compare(b, Qt::CaseInsensitive) < 0;
    });
    return out;
}

bool exists(const QString& name) {
    return readStore().value("profiles").toObject().contains(name);
}

bool load(const QString& name, WorkspaceProfile* out) {
    if (!out) return false;
    const QJsonObject all = readStore().value("profiles").toObject();
    if (!all.contains(name)) return false;
    *out = WorkspaceProfile::fromJson(name, all.value(name).toObject());
    return true;
}

bool save(const WorkspaceProfile& p) {
    const QString name = p.name.trimmed();
    if (name.isEmpty()) return false;
    QJsonObject store = readStore();
    QJsonObject all = store.value("profiles").toObject();
    all[name] = p.toJson();
    store["profiles"] = all;
    store["lastUsed"] = name;
    return writeStore(store);
}

bool remove(const QString& name) {
    QJsonObject store = readStore();
    QJsonObject all = store.value("profiles").toObject();
    if (!all.contains(name)) return false;
    all.remove(name);
    store["profiles"] = all;
    // Drop the marker too, or the menu would go on pointing at a profile that
    // is no longer there.
    if (store.value("lastUsed").toString() == name) store["lastUsed"] = QString();
    return writeStore(store);
}

QString lastUsed() { return readStore().value("lastUsed").toString(); }

void setLastUsed(const QString& name) {
    QJsonObject store = readStore();
    store["lastUsed"] = name;
    writeStore(store);
}

}  // namespace Profiles
