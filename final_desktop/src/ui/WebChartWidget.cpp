#include "ui/WebChartWidget.h"
#include "core/ChartBridge.h"
#include "ui/OrderTicket.h"
#include "ui/Theme.h"
#include <QWebEngineView>
#include <QWebEnginePage>
#include <QWebEngineSettings>
#include <QWebEngineProfile>
#include <QWebChannel>
#include <QVBoxLayout>
#include <QCoreApplication>
#include <QFileInfo>
#include <QFile>
#include <QDir>
#include <QStandardPaths>
#include <QDateTime>
#include <QResizeEvent>
#include <QUrl>
#include <QFileDialog>
#include <QMessageBox>
#include <QInputDialog>
#include <QLineEdit>
#include <QJsonDocument>
#include <QJsonArray>
#include <QPainter>
#include <QPrinter>
#include <QPrintDialog>
#include <QPrintPreviewDialog>

#ifndef TX_SOURCE_WEB_DIR
#define TX_SOURCE_WEB_DIR ""
#endif

// Where the JS diagnostic log goes.
//
// On Windows the terminal is installed per-user and the exe directory is
// writable, so the log sits next to terminal.exe — easy to find and to attach
// to a bug report.
//
// A mac app bundle in /Applications is NOT writable without admin rights, and
// Contents/MacOS is inside the code signature: writing there would either fail
// silently (leaving no diagnostics at all) or break the signature. So the log
// moves to Application Support, which is per-user and writable.
static QString diagLogPath() {
#ifdef Q_OS_MACOS
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    if (!dir.isEmpty()) {
        QDir().mkpath(dir);
        return dir + "/chart-diag.log";
    }
#endif
    return QCoreApplication::applicationDirPath() + "/chart-diag.log";
}

// Logs JS console output + page errors so chart issues are diagnosable without
// opening devtools. See diagLogPath() for where it lands.
class DiagPage : public QWebEnginePage {
public:
    using QWebEnginePage::QWebEnginePage;
protected:
    void javaScriptConsoleMessage(JavaScriptConsoleMessageLevel level, const QString& msg,
                                  int line, const QString& source) override {
        const char* lv = level == InfoMessageLevel ? "INFO"
                       : level == WarningMessageLevel ? "WARN" : "ERROR";
        QFile f(diagLogPath());
        if (f.open(QIODevice::Append | QIODevice::Text)) {
            QString src = source.section('/', -1);
            f.write(QString("%1 [%2] %3:%4  %5\n")
                    .arg(QDateTime::currentDateTime().toString("hh:mm:ss"), lv, src)
                    .arg(line).arg(msg).toUtf8());
        }
    }
};

WebChartWidget::WebChartWidget(ApiClient* api, PriceStream* stream, QWidget* parent)
    : QWidget(parent) {
    m_bridge  = new ChartBridge(api, stream, this);
    m_view    = new QWebEngineView(this);

    // Off-the-record profile → no persistent cache, so JS/HTML updates ALWAYS
    // load fresh (a stale cached datafeed was showing the old exchange label).
    auto* profile = new QWebEngineProfile(this);   // unnamed = off-the-record
    profile->setHttpCacheType(QWebEngineProfile::NoCache);
    m_view->setPage(new DiagPage(profile, m_view));

    m_channel = new QWebChannel(this);
    m_channel->registerObject(QStringLiteral("sc"), m_bridge);
    m_view->page()->setWebChannel(m_channel);

    // The page reports when a TradingView dialog opens. A native child widget
    // always paints above the web view, so the only way to stop the one-click
    // strip covering those dialogs is to take it off screen while they are up.
    connect(m_bridge, &ChartBridge::symbolPickedInChart,
            this, &WebChartWidget::symbolPickedInChart);
    connect(m_bridge, &ChartBridge::studiesChanged,
            this, &WebChartWidget::studiesChanged);
    connect(m_bridge, &ChartBridge::resolutionChanged,
            this, &WebChartWidget::resolutionChanged);
    connect(m_bridge, &ChartBridge::saveImageRequested,
            this, &WebChartWidget::saveChartImage);
    connect(m_bridge, &ChartBridge::printRequested,
            this, &WebChartWidget::printChart);
    connect(m_bridge, &ChartBridge::templateSaveRequested,
            this, &WebChartWidget::saveTemplate);
    connect(m_bridge, &ChartBridge::overlayHiddenChanged, this, [this](bool hidden) {
        if (m_overlay) m_overlay->setVisible(!hidden);
    });

    // Truncate the diagnostic log at startup, then record load status.
    const QString diag = diagLogPath();
    QFile::remove(diag);
    connect(m_view, &QWebEngineView::loadFinished, this, [diag](bool ok) {
        QFile f(diag);
        if (f.open(QIODevice::Append | QIODevice::Text))
            f.write(QString("%1 [LOAD] finished ok=%2\n")
                    .arg(QDateTime::currentDateTime().toString("hh:mm:ss"))
                    .arg(ok ? "true" : "false").toUtf8());
    });

    // Allow the local index.html to load its sibling JS/vendor assets.
    auto* s = m_view->settings();
    s->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, true);
    s->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, true);
    s->setAttribute(QWebEngineSettings::JavascriptEnabled, true);

    // Boot the page in the active theme — app.js reads `sc.theme` on startup.
    m_bridge->setTheme(Theme::name());
    m_view->page()->setBackgroundColor(QColor(Theme::isDark() ? "#0e0f13" : "#ffffff"));

    auto* lay = new QVBoxLayout(this);
    lay->setContentsMargins(0, 0, 0, 0);
    lay->addWidget(m_view);

    const QString index = resolveIndexHtml();
    if (!index.isEmpty())
        m_view->setUrl(QUrl::fromLocalFile(index));
}

QString WebChartWidget::resolveIndexHtml() {
    const QString appDir = QCoreApplication::applicationDirPath();
#ifdef Q_OS_MACOS
    // 0) inside the app bundle. applicationDirPath() is Contents/MacOS, and
    //    CMake's POST_BUILD step puts the web layer in Contents/Resources/web —
    //    the only location Apple treats as bundle data rather than as code.
    const QString bundled =
        QDir::cleanPath(appDir + "/../Resources/web/index.html");
    if (QFileInfo::exists(bundled)) return bundled;
#endif
    // 1) next to the executable (deployed Windows layout: <exe>/web/index.html)
    const QString beside = appDir + "/web/index.html";
    if (QFileInfo::exists(beside)) return beside;
    // 2) source tree (dev)
    const QString src = QStringLiteral(TX_SOURCE_WEB_DIR) + "/index.html";
    if (QFileInfo::exists(src)) return src;
    return {};
}

void WebChartWidget::setOverlayWidget(QWidget* w) {
    if (!w) return;
    m_overlay = w;
    // The strip re-sizes itself when a longer price arrives (BTCUSD's six
    // figures against EURUSD's five decimals). Nothing else would notice — it
    // is placed by hand, not by a layout — so it says so and we re-place it.
    // Unique connection: setOverlayWidget runs again on every pane switch.
    if (auto* t = qobject_cast<OrderTicket*>(w))
        connect(t, &OrderTicket::sizeHintChanged, this,
                &WebChartWidget::positionOverlay, Qt::UniqueConnection);
    // Deliberately NOT added to the layout: it has to sit on top of the web
    // view, not beside it. raise() puts it above the view in the stacking order.
    w->setParent(this);
    w->raise();
    w->show();
    positionOverlay();
}

void WebChartWidget::positionOverlay() {
    if (!m_overlay) return;
    // A reparented widget keeps whatever geometry it had (a parentless widget
    // defaults to 640x480), and with no layout governing it nothing ever
    // corrects that — the strip stretched its BUY/SELL tiles right across the
    // chart. Size it to its own sizeHint on every reposition instead.
    m_overlay->adjustSize();
    // Parked over the candles at the top right, BELOW the chart's own toolbar
    // and below its legend.
    //
    // It used to sit in the toolbar band itself (y = 0), in the empty run
    // between the Indicators controls and the icon cluster on the right. That
    // run only exists on a wide chart. Narrow the pane — a 2x2 grid, or a
    // window dragged in — and the placement clamped left until the strip
    // covered the timeframe selector, which sits at roughly x=109 in that same
    // row. The interval a chart is on is not something a trader can be asked
    // to trade without, and no horizontal position is safe at every width.
    //
    // Dropping below the toolbar removes the width dependence, because the
    // separation becomes vertical: the toolbar band is 38px tall and the
    // legend's rows (OHLC, then Volume) end at 96px on a quarter pane, which
    // is the tightest case. 104 clears both with a small gap.
    //
    // Measured against the running chart rather than guessed, at full width
    // and in a 2x2 — at 104 every probe point under the strip is bare canvas,
    // where the old placement sat squarely on the interval button.
    // A strip the trader has dragged stays where they put it. The fraction is
    // re-applied against the CURRENT pane size, so it holds its place through
    // a resize or a grid change instead of drifting off the edge.
    if (auto* t = qobject_cast<OrderTicket*>(m_overlay)) {
        if (t->hasCustomPosition()) {
            const int roomX = qMax(0, width()  - m_overlay->width());
            const int roomY = qMax(0, height() - m_overlay->height());
            m_overlay->move(int(t->positionRatio().x() * roomX),
                            int(t->positionRatio().y() * roomY));
            m_overlay->raise();
            return;
        }
    }

    const int toolbarAndLegend = 104;
    // Only the price axis has to be cleared now, not the toolbar's icons too.
    const int priceAxisW = 72;
    const int x = qMax(58, width() - m_overlay->width() - priceAxisW);
    m_overlay->move(x, toolbarAndLegend);
    m_overlay->raise();
}

void WebChartWidget::resizeEvent(QResizeEvent* e) {
    QWidget::resizeEvent(e);
    positionOverlay();
}

void WebChartWidget::setSymbols(const QVector<SymbolSpec>& symbols) {
    m_bridge->setSymbols(symbols);
}

void WebChartWidget::showSymbol(const QString& symbol) {
    m_bridge->setCurrentSymbol(symbol);
}

void WebChartWidget::setPositions(const QVector<OpenPosition>& positions) {
    m_bridge->setPositions(positions);
}

void WebChartWidget::setCompact(bool compact) {
    m_bridge->setCompact(compact);
}

void WebChartWidget::setDataWindow(bool on) {
    m_bridge->setDataWindow(on);
}

QString WebChartWidget::studies() const {
    return m_bridge->studies();
}

void WebChartWidget::createStudy(const QString& name) {
    m_bridge->createStudy(name);
}

QString WebChartWidget::chartState() const {
    return m_bridge->chartState();
}

void WebChartWidget::setChartState(const QString& stateJson) {
    m_bridge->loadChartState(stateJson);
}

// ── "Save As Picture…", "Print Preview" and "Print…" ────────────────────────
//
// One capture serves all three, so the printed page and the saved PNG are the
// chart exactly as it was on screen.
//
// grab() on the web view, rather than a screen capture of the same rectangle.
// A screen capture would pick up anything overlapping the chart — the one-click
// strip, a tooltip, another window — and on macOS it would need the screen
// recording permission, which is a dialog nobody expects from a trading
// terminal. QtWebEngine paints the page through the widget's normal paint path
// here, which is why this works at all; it is also why the one-click strip,
// which is a sibling widget rather than part of the view, is correctly absent.
QPixmap WebChartWidget::captureChart() const {
    if (!m_view) return {};
    const QPixmap pm = m_view->grab();
    // A null grab is possible if the view has never been shown. Say so rather
    // than writing an empty file the trader has to open to discover is blank.
    if (pm.isNull() || pm.width() < 2 || pm.height() < 2) return {};
    return pm;
}

void WebChartWidget::saveChartImage() {
    const QPixmap pm = captureChart();
    if (pm.isNull()) {
        QMessageBox::warning(this, tr("Save As Picture"),
                             tr("The chart could not be captured. Try again once "
                                "it has finished loading."));
        return;
    }

    // Named after the instrument and the moment, because the alternative is a
    // folder of chart1.png … chart9.png that nobody can tell apart later.
    const QString stamp = QDateTime::currentDateTime().toString("yyyy-MM-dd_HH-mm-ss");
    const QString symbol = m_bridge->currentSymbol().isEmpty()
                             ? QStringLiteral("chart") : m_bridge->currentSymbol();
    const QString suggested =
        QStandardPaths::writableLocation(QStandardPaths::PicturesLocation)
        + QString("/%1_%2.png").arg(symbol, stamp);

    const QString path = QFileDialog::getSaveFileName(
        this, tr("Save As Picture"), suggested, tr("PNG image (*.png)"));
    if (path.isEmpty()) return;          // cancelled

    if (!pm.save(path, "PNG"))
        QMessageBox::warning(this, tr("Save As Picture"),
                             tr("Could not write %1.").arg(path));
}

void WebChartWidget::printChart(bool preview) {
    const QPixmap pm = captureChart();
    if (pm.isNull()) {
        QMessageBox::warning(this, tr("Print"),
                             tr("The chart could not be captured. Try again once "
                                "it has finished loading."));
        return;
    }

    // Landscape: a chart is far wider than it is tall, and portrait would put
    // it in a band across the middle of the sheet with the rest blank.
    QPrinter printer(QPrinter::HighResolution);
    printer.setPageOrientation(QPageLayout::Landscape);

    // Scaled to fit the page, keeping the aspect ratio and centred. A chart
    // stretched to the paper's proportions is a chart with the wrong slope on
    // every trend line on it.
    auto paint = [&pm](QPrinter* target) {
        QPainter p(target);
        if (!p.isActive()) return;
        const QRect page = target->pageLayout().paintRectPixels(target->resolution());
        QSize size = pm.size();
        size.scale(page.size(), Qt::KeepAspectRatio);
        const QRect where(page.x() + (page.width()  - size.width())  / 2,
                          page.y() + (page.height() - size.height()) / 2,
                          size.width(), size.height());
        p.drawPixmap(where, pm);
    };

    if (preview) {
        QPrintPreviewDialog dlg(&printer, this);
        dlg.setWindowTitle(tr("Print Preview"));
        connect(&dlg, &QPrintPreviewDialog::paintRequested, this,
                [&paint](QPrinter* target) { paint(target); });
        dlg.exec();
        return;
    }

    QPrintDialog dlg(&printer, this);
    dlg.setWindowTitle(tr("Print chart"));
    if (dlg.exec() != QDialog::Accepted) return;
    paint(&printer);
}

// "Save Template…" from the chart's right-click menu.
//
// Both halves arrive already captured — the indicators and the drawings —
// because only the page can produce either and only it knows the moment the
// trader asked. All that is left is a name, and that has to be asked for here:
// a prompt raised inside the page would be a browser dialog planted in the
// middle of the chart, and QtWebEngine is within its rights to refuse to show
// one at all.
void WebChartWidget::saveTemplate(const QString& studyJson, const QString& drawingsJson) {
    bool ok = false;
    const QString name = QInputDialog::getText(
        this, tr("Save Template"),
        tr("Name this template.\n\nIt keeps every indicator and every drawing on "
           "this chart. Applying it later leaves the instrument and the "
           "timeframe alone — a template is a setup, not a symbol."),
        QLineEdit::Normal, QString(), &ok).trimmed();
    if (!ok || name.isEmpty()) return;

    // Overwriting is allowed but never silent: these are hand-made setups and
    // losing one to a name collision is not a small thing.
    const QJsonArray existing =
        QJsonDocument::fromJson(m_bridge->listStudyTemplates().toUtf8()).array();
    for (const QJsonValue& v : existing) {
        if (v.toString() != name) continue;
        if (QMessageBox::question(
                this, tr("Save Template"),
                tr("A template called \"%1\" already exists. Replace it?").arg(name))
            != QMessageBox::Yes)
            return;
        break;
    }

    m_bridge->storeTemplate(name, studyJson, drawingsJson);
}

void WebChartWidget::setResolution(const QString& res) {
    m_bridge->setResolution(res);
}

QString WebChartWidget::resolution() const {
    return m_bridge->resolution();
}

void WebChartWidget::selectLineTool(const QString& tool) {
    m_bridge->selectLineTool(tool);
}

void WebChartWidget::setTheme(const QString& theme) {
    m_bridge->setTheme(theme);
    // The page paints its own background before the widget boots; keep the
    // WebEngine backdrop in step so there's no white/black flash on switch.
    m_view->page()->setBackgroundColor(QColor(theme == "light" ? "#ffffff" : "#0e0f13"));
}
