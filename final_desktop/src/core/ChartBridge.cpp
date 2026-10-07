#include "core/ChartBridge.h"
#include "core/ApiClient.h"
#include "core/PriceStream.h"
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QStandardPaths>
#include <QDateTime>
#include <QDir>
#include <QFile>

ChartBridge::ChartBridge(ApiClient* api, PriceStream* stream, QObject* parent)
    : QObject(parent), m_api(api), m_stream(stream) {
    connect(m_api,    &ApiClient::barsReceived,   this, &ChartBridge::onBarsReceived);
    connect(m_api,    &ApiClient::barsFailed,     this, &ChartBridge::onBarsFailed);
    connect(m_stream, &PriceStream::tickReceived, this, &ChartBridge::onTick);
    // Relay per-position modify/close outcomes to the broker adapter.
    connect(m_api, &ApiClient::positionOpResult, this,
            [this](const QString& id, const QString& op, bool ok, const QString& msg) {
                emit positionOp(id, op, ok, msg);
            });
}

// ── Saved chart layouts and templates ──────────────────────────────────────
//
// One JSON file beside config.json, re-read on every operation. Four chart
// panes each hold their own ChartBridge and all of them write here, so holding
// the document in memory would let the last pane to save overwrite whatever
// the others had added since it loaded.

static QString storePath() {
    QString dir = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    if (dir.isEmpty()) dir = QDir::homePath() + "/.vxness-terminal";
    QDir().mkpath(dir);
    return dir + "/chart-templates.json";
}

static QJsonObject readStore() {
    QFile f(storePath());
    if (!f.open(QIODevice::ReadOnly)) return {};
    return QJsonDocument::fromJson(f.readAll()).object();
}

static void writeStore(const QJsonObject& o) {
    QFile f(storePath());
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate)) return;
    f.write(QJsonDocument(o).toJson(QJsonDocument::Indented));
}

// A named string in a named bucket — study, chart and drawing templates are
// all that shape, only the bucket differs.
static QString namedGet(const QString& bucket, const QString& name) {
    return readStore().value(bucket).toObject().value(name).toString();
}
static void namedPut(const QString& bucket, const QString& name, const QString& content) {
    if (name.isEmpty()) return;
    QJsonObject store = readStore();
    QJsonObject b = store.value(bucket).toObject();
    b[name] = content;
    store[bucket] = b;
    writeStore(store);
}
static void namedRemove(const QString& bucket, const QString& name) {
    QJsonObject store = readStore();
    QJsonObject b = store.value(bucket).toObject();
    if (!b.contains(name)) return;
    b.remove(name);
    store[bucket] = b;
    writeStore(store);
}
static QString namedList(const QString& bucket) {
    QJsonArray names;
    const QJsonObject b = readStore().value(bucket).toObject();
    for (auto it = b.begin(); it != b.end(); ++it) names.append(it.key());
    return QString::fromUtf8(QJsonDocument(names).toJson(QJsonDocument::Compact));
}

QString ChartBridge::listCharts() const {
    // Metadata only. The library lists saved layouts long before anyone opens
    // one, and every content blob carries a chart's whole drawing set.
    QJsonArray out;
    for (const QJsonValue& v : readStore().value("charts").toArray()) {
        const QJsonObject c = v.toObject();
        QJsonObject meta;
        meta["id"]         = c.value("id").toString();
        meta["name"]       = c.value("name").toString();
        meta["symbol"]     = c.value("symbol").toString();
        meta["resolution"] = c.value("resolution").toString();
        meta["timestamp"]  = c.value("timestamp").toDouble();
        out.append(meta);
    }
    return QString::fromUtf8(QJsonDocument(out).toJson(QJsonDocument::Compact));
}

QString ChartBridge::chartContent(const QString& id) const {
    for (const QJsonValue& v : readStore().value("charts").toArray())
        if (v.toObject().value("id").toString() == id)
            return v.toObject().value("content").toString();
    return {};
}

QString ChartBridge::saveChart(const QString& id, const QString& name,
                               const QString& symbol, const QString& resolution,
                               const QString& content) {
    QJsonObject store = readStore();
    QJsonArray charts = store.value("charts").toArray();

    // "Save" overwrites the layout it was opened from; "Save as" arrives with
    // no id and becomes a new one. Ids are a monotonic counter rather than an
    // array index, so deleting a layout cannot make a later save collide with
    // one that is still there.
    QString outId = id;
    if (outId.isEmpty()) {
        const int next = store.value("nextId").toInt(1);
        outId = QString::number(next);
        store["nextId"] = next + 1;
    }

    QJsonObject rec;
    rec["id"]         = outId;
    rec["name"]       = name;
    rec["symbol"]     = symbol;
    rec["resolution"] = resolution;
    rec["timestamp"]  = static_cast<double>(QDateTime::currentSecsSinceEpoch());
    rec["content"]    = content;

    bool replaced = false;
    for (int i = 0; i < charts.size(); ++i) {
        if (charts.at(i).toObject().value("id").toString() == outId) {
            charts.replace(i, rec);
            replaced = true;
            break;
        }
    }
    if (!replaced) charts.append(rec);

    store["charts"] = charts;
    writeStore(store);
    return outId;
}

void ChartBridge::removeChart(const QString& id) {
    QJsonObject store = readStore();
    QJsonArray charts = store.value("charts").toArray();
    for (int i = 0; i < charts.size(); ++i) {
        if (charts.at(i).toObject().value("id").toString() == id) {
            charts.removeAt(i);
            store["charts"] = charts;
            writeStore(store);
            return;
        }
    }
}

QString ChartBridge::listStudyTemplates() const     { return namedList("studyTemplates"); }
QString ChartBridge::studyTemplateContent(const QString& name) const {
    return namedGet("studyTemplates", name);
}
// An indicator template carries indicators and nothing else.
//
// The charting library writes whatever its save dialog was ticked for, which
// includes the instrument and the timeframe. A template that remembers an
// instrument is not a template: applying it to a second chart dragged that
// chart onto the first one's symbol — reported from the desk as "once save in
// template same symbol get in chart".
//
// Stripped HERE, in the store, rather than in the JS adapter that happens to
// call it: this is the only place a template can be written, so the guarantee
// holds however it was created.
void ChartBridge::saveStudyTemplate(const QString& name, const QString& content) {
    QJsonObject o = QJsonDocument::fromJson(content.toUtf8()).object();
    if (o.isEmpty()) {                 // not an object we understand; store as-is
        namedPut("studyTemplates", name, content);
        return;
    }
    o.remove("symbol");
    o.remove("interval");
    o.remove("resolution");
    namedPut("studyTemplates", name,
             QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Compact)));
}
// Deletes BOTH halves. The library's own dialog calls this one, and a template
// deleted there that left its drawings behind would hand them to the next
// template that happened to reuse the name.
void ChartBridge::removeStudyTemplate(const QString& name) {
    namedRemove("studyTemplates", name);
    namedRemove("templateDrawings", name);
}

QString ChartBridge::listChartTemplates() const     { return namedList("chartTemplates"); }
QString ChartBridge::chartTemplateContent(const QString& name) const {
    return namedGet("chartTemplates", name);
}
void ChartBridge::saveChartTemplate(const QString& name, const QString& content) {
    namedPut("chartTemplates", name, content);
}
void ChartBridge::removeChartTemplate(const QString& name) {
    namedRemove("chartTemplates", name);
}

// Drawing templates are per TOOL — a "Fib Retracement" template must not be
// offered on a trend line — so the bucket is nested one level deeper.
// The drawings half of a template — see the header for why it is a bucket of
// its own rather than part of the study template beside it.
QString ChartBridge::templateDrawings(const QString& name) const {
    return namedGet("templateDrawings", name);
}

void ChartBridge::saveTemplateDrawings(const QString& name, const QString& content) {
    if (name.trimmed().isEmpty()) return;
    // An empty state is written rather than skipped. Saving a template from a
    // chart with nothing drawn on it MUST clear whatever the previous template
    // of that name carried, or the old drawings come back on the next load.
    namedPut("templateDrawings", name, content);
}

void ChartBridge::storeTemplate(const QString& name, const QString& studyJson,
                                const QString& drawingsJson) {
    if (name.trimmed().isEmpty() || studyJson.isEmpty()) return;
    // Through saveStudyTemplate(), not namedPut(), so a template saved from our
    // own menu gets the same symbol and interval stripped out as one saved from
    // the library's dialog.
    saveStudyTemplate(name, studyJson);
    saveTemplateDrawings(name, drawingsJson);
}

void ChartBridge::removeTemplate(const QString& name) {
    namedRemove("studyTemplates", name);
    namedRemove("templateDrawings", name);
}

void ChartBridge::saveTemplateAs(const QString& studyJson, const QString& drawingsJson) {
    if (studyJson.isEmpty()) return;
    emit templateSaveRequested(studyJson, drawingsJson);
}

QString ChartBridge::listDrawingTemplates(const QString& tool) const {
    return namedList("drawingTemplates/" + tool);
}
QString ChartBridge::drawingTemplateContent(const QString& tool, const QString& name) const {
    return namedGet("drawingTemplates/" + tool, name);
}
void ChartBridge::saveDrawingTemplate(const QString& tool, const QString& name,
                                      const QString& content) {
    namedPut("drawingTemplates/" + tool, name, content);
}
void ChartBridge::removeDrawingTemplate(const QString& tool, const QString& name) {
    namedRemove("drawingTemplates/" + tool, name);
}

void ChartBridge::setSymbols(const QVector<SymbolSpec>& symbols) {
    QJsonArray arr;
    for (const SymbolSpec& s : symbols) {
        QJsonObject o;
        o["symbol"]       = s.symbol;
        o["display_name"] = s.displayName;
        o["category"]     = s.category;
        o["digits"]       = s.digits;
        // Lets the chart preview the money value of an SL/TP level before the
        // user commits it (profit = (level - open) * dir * lots * contract).
        o["contract_size"] = s.contractSize;
        arr.append(o);
    }
    m_symbolsJson = QString::fromUtf8(QJsonDocument(arr).toJson(QJsonDocument::Compact));
    emit symbolsChanged();
}

void ChartBridge::setPositions(const QVector<OpenPosition>& positions) {
    QJsonArray arr;
    for (const OpenPosition& p : positions) {
        QJsonObject o;
        o["id"]            = p.id;
        o["symbol"]        = p.symbol;
        o["side"]          = p.side;          // "buy" | "sell"
        o["lots"]          = p.lots;
        o["open_price"]    = p.openPrice;
        o["current_price"] = p.currentPrice;
        o["sl"]            = p.sl;
        o["tp"]            = p.tp;
        o["profit"]        = p.profit;
        o["quote_to_usd"]  = p.quoteToUsd;
        o["mark_bid"]      = p.markBid;
        arr.append(o);
    }
    QString next = QString::fromUtf8(QJsonDocument(arr).toJson(QJsonDocument::Compact));
    if (next == m_positionsJson) return;   // nothing changed; don't churn the chart
    m_positionsJson = next;
    emit positionsChanged();
}

void ChartBridge::modifyBracket(const QString& positionId, const QString& kind, double level) {
    m_api->modifyBracket(positionId, kind, level);
}

void ChartBridge::closePosition(const QString& positionId) {
    m_api->closePositionById(positionId);
}

void ChartBridge::setOverlayHidden(bool hidden) {
    emit overlayHiddenChanged(hidden);
}

// ── Workspace profiles ──────────────────────────────────────────────────────

void ChartBridge::pushChartState(const QString& stateJson) {
    // Only ever cached, never written to disk from here. Profiles are the one
    // thing that persists it, and they store it in their own file so a pane's
    // running state cannot quietly overwrite a profile the trader saved.
    if (!stateJson.isEmpty()) m_chartState = stateJson;
}

void ChartBridge::pushStudies(const QString& namesJson) {
    if (namesJson.isEmpty()) return;
    m_studies = namesJson;
    emit studiesChanged();
}

void ChartBridge::createStudy(const QString& name) {
    if (name.trimmed().isEmpty()) return;
    emit studyRequested(name);
}

void ChartBridge::setResolution(const QString& res) {
    if (res.trimmed().isEmpty()) return;
    // Deliberately NOT guarded on m_resolution. The toolbar highlight is driven
    // by chartResolutionPicked(), which only fires once the library has really
    // switched — so a request that the chart quietly refused (a resolution the
    // datafeed cannot serve) must stay re-sendable rather than being swallowed
    // as "already there".
    emit resolutionRequested(res);
}

void ChartBridge::selectLineTool(const QString& tool) {
    if (tool.trimmed().isEmpty()) return;
    emit lineToolRequested(tool);
}

void ChartBridge::requestSaveImage() {
    emit saveImageRequested();
}

void ChartBridge::requestPrint(bool preview) {
    emit printRequested(preview);
}

void ChartBridge::chartResolutionPicked(const QString& res) {
    if (res.isEmpty() || res == m_resolution) return;
    m_resolution = res;
    emit resolutionChanged(res);
}

void ChartBridge::loadChartState(const QString& stateJson) {
    if (stateJson.isEmpty()) return;
    // Take the cache along at once. The web layer will push the same state
    // back after it loads, but a profile switched twice in quick succession
    // would otherwise capture the state the pane is leaving behind.
    m_chartState = stateJson;
    emit chartStateLoad(stateJson);
}

void ChartBridge::setTheme(const QString& theme) {
    if (theme == m_theme) return;
    m_theme = theme;
    emit themeChanged(theme);
}

void ChartBridge::setDataWindow(bool on) {
    if (on == m_dataWindow) return;
    m_dataWindow = on;
    emit dataWindowChanged(on);
}

void ChartBridge::setCompact(bool compact) {
    if (compact == m_compact) return;
    m_compact = compact;
    emit compactChanged(compact);
}

void ChartBridge::setCurrentSymbol(const QString& symbol) {
    if (symbol.isEmpty() || symbol == m_currentSymbol) return;
    m_currentSymbol = symbol;
    emit symbolChanged(symbol);
}

void ChartBridge::chartSymbolPicked(const QString& symbol) {
    if (symbol.isEmpty() || symbol == m_currentSymbol) return;
    // Adopt it as the chart's symbol so onTick() stops filtering the new one
    // out.
    m_currentSymbol = symbol;
    emit symbolPickedInChart(symbol);
    // symbolChanged is the property's NOTIFY, and WebChannel only refreshes the
    // JS-side copy of currentSymbol when it fires. Skipping it left JS reading
    // the old symbol forever, which decides which symbol a rebuilt widget opens
    // on. It does travel back to the chart that raised this, so the handler
    // over there ignores a symbol the chart is already showing.
    emit symbolChanged(symbol);
}

void ChartBridge::requestBars(const QString& symbol, const QString& timeframe,
                              double /*fromSec*/, double toSec, const QString& reqId) {
    // The window's END goes to the server, so scrolling back pages through
    // history instead of receiving the newest 1000 bars again (which capped the
    // chart at 1000 candles). JS still trims to the exact window it asked for.
    const QString tag = QStringLiteral("cb%1-%2")
                            .arg(reinterpret_cast<quintptr>(this), 0, 16).arg(reqId);
    m_pending.insert(tag, reqId);
    m_api->fetchBars(symbol, timeframe, 1000, static_cast<qint64>(toSec), tag);
}

void ChartBridge::onBarsFailed(const QString& tag, const QString& /*message*/) {
    const QString reqId = m_pending.take(tag);
    if (reqId.isEmpty()) return;   // not ours
    // An honest "no data" now, rather than a spinner until the JS timeout.
    emit barsReady(reqId, QStringLiteral("[]"));
}

void ChartBridge::onBarsReceived(const QString& /*symbol*/, const QString& /*timeframe*/,
                                 const QVector<Bar>& bars, const QString& tag) {
    const QString reqId = m_pending.take(tag);
    if (reqId.isEmpty()) return;   // not ours

    QJsonArray arr;
    for (const Bar& b : bars) {
        QJsonObject o;
        o["time"]   = b.time.toString(Qt::ISODateWithMs);
        o["open"]   = b.open;
        o["high"]   = b.high;
        o["low"]    = b.low;
        o["close"]  = b.close;
        o["volume"] = b.volume;
        arr.append(o);
    }
    emit barsReady(reqId, QString::fromUtf8(QJsonDocument(arr).toJson(QJsonDocument::Compact)));
}

void ChartBridge::onTick(const Quote& q) {
    // Only forward ticks for the symbol the chart is showing. The stream
    // carries all ~60 symbols (30-100 ticks/s); pushing every one across the
    // WebChannel to JS made the chart laggy. The chart needs one symbol.
    if (q.symbol != m_currentSymbol) return;
    emit tick(q.symbol, q.bid, q.ask, static_cast<double>(q.timestamp.toMSecsSinceEpoch()), q.mid);
}
