#pragma once
#include <QWidget>
#include <QPixmap>
#include "core/Models.h"

class ApiClient;
class PriceStream;
class ChartBridge;
class QWebEngineView;
class QWebChannel;

// Hosts the TradingView Advanced Charts library inside a QWebEngineView.
// Data flows through a ChartBridge exposed over QWebChannel as `sc`.
class WebChartWidget : public QWidget {
    Q_OBJECT
public:
    WebChartWidget(ApiClient* api, PriceStream* stream, QWidget* parent = nullptr);

    void setSymbols(const QVector<SymbolSpec>& symbols);
    void showSymbol(const QString& symbol);
    void setPositions(const QVector<OpenPosition>& positions);   // feeds broker adapter
    void setTheme(const QString& theme);   // "dark" | "light" -> TradingView + overlay

    // Floats a widget over the top-left of the chart canvas — MT5 parks its
    // one-click trading panel there. The widget is reparented onto this one and
    // kept above the web view; it is NOT put in the layout, so it never steals
    // space from the chart.
    void setOverlayWidget(QWidget* w);

    // Reduced chrome for a pane sharing the window with others — see
    // ChartBridge::compact.
    void setCompact(bool compact);

    // View > Data Window: the library's widget-bar panel with OHLCV and every
    // indicator's value at the crosshair. Rebuilds the chart, like setCompact.
    void setDataWindow(bool on);

    // ── Workspace profiles ──
    // This pane's symbol, timeframe, indicators and drawings, as the charting
    // library serialises them. Empty until the chart has finished loading —
    // see ChartBridge::pushChartState for why it is a cache and not a call.
    // ── View > Navigation: Indicators ──
    // The indicator names this chart can draw, as a JSON array. Empty until the
    // chart has loaded and reported them.
    QString studies() const;
    void    createStudy(const QString& name);
    QString chartState() const;
    void    setChartState(const QString& stateJson);

    // ── The timeframe and drawing toolbars ──
    // Both live inside the charting library; these hand a native button's
    // choice down to it. See ChartBridge::setResolution.
    void    setResolution(const QString& res);
    QString resolution() const;
    void    selectLineTool(const QString& tool);

signals:
    // The trader picked a symbol inside the chart itself. Relayed so the pane
    // header can follow, and so the choice survives a restart.
    void symbolPickedInChart(const QString& symbol);
    // The indicator list arrived from the web layer.
    void studiesChanged();
    // This pane's timeframe changed, from a toolbar button or from inside the
    // chart. The toolbar highlight follows it.
    void resolutionChanged(const QString& res);

protected:
    void resizeEvent(QResizeEvent* e) override;

private slots:
    // Also invoked when the overlay reports a new size hint, so it must be a
    // slot rather than a plain private helper.
    void positionOverlay();

    // ── the chart's right-click menu, native half ──
    // "Save As Picture…" and "Print" / "Print Preview". Both work off one
    // capture of the chart as it is on screen, so what is printed is what the
    // trader was looking at — which is the whole point of printing a chart.
    void saveChartImage();
    void printChart(bool preview);

    // "Save Template…" — names the two halves the page just handed over (the
    // indicators and the drawings), and warns before writing over a template
    // that already exists.
    void saveTemplate(const QString& studyJson, const QString& drawingsJson);

private:
    static QString resolveIndexHtml();   // locate web/index.html
    // The chart as it looks right now. Empty if the capture failed, which
    // callers must check rather than saving a blank sheet.
    QPixmap captureChart() const;

    ChartBridge*    m_bridge;
    QWebEngineView* m_view;
    QWebChannel*    m_channel;
    QWidget*        m_overlay = nullptr;
};
