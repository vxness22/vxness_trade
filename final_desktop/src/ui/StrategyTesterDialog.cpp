#include "ui/StrategyTesterDialog.h"
#include "core/ApiClient.h"
#include "ui/ReportsDialog.h"
#include "ui/Theme.h"

#include <QComboBox>
#include <QDateTime>
#include <QDir>
#include <QDoubleSpinBox>
#include <QFile>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QPainter>
#include <QPainterPath>
#include <QPaintEvent>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSpinBox>
#include <QStandardPaths>
#include <QTimer>
#include <QVBoxLayout>

#include <algorithm>

namespace {

QString scriptsDir() {
    QString dir = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    if (dir.isEmpty()) dir = QDir::homePath() + "/.vxness-terminal";
    return dir + "/scripts";
}

// The equity curve. A bespoke widget rather than a charting dependency: it is
// one polyline, and the terminal already carries one charting engine.
class EquityCurve : public QWidget {
public:
    explicit EquityCurve(QWidget* parent = nullptr) : QWidget(parent) {
        setMinimumHeight(140);
    }
    void setSeries(const QVector<double>& values, double start) {
        m_values = values;
        m_start = start;
        update();
    }

protected:
    void paintEvent(QPaintEvent*) override {
        QPainter p(this);
        p.setRenderHint(QPainter::Antialiasing);
        const auto& t = Theme::p();
        p.fillRect(rect(), QColor(t.tableBg));
        p.setPen(QPen(QColor(t.border), 1));
        p.drawRect(rect().adjusted(0, 0, -1, -1));

        if (m_values.size() < 2) {
            p.setPen(QColor(t.muted));
            p.drawText(rect(), Qt::AlignCenter, tr("Run a test to see the equity curve"));
            return;
        }

        double lo = *std::min_element(m_values.begin(), m_values.end());
        double hi = *std::max_element(m_values.begin(), m_values.end());
        lo = qMin(lo, m_start);
        hi = qMax(hi, m_start);
        if (qFuzzyCompare(lo, hi)) { hi = lo + 1.0; }

        const QRectF area = rect().adjusted(8, 8, -8, -8);
        auto xAt = [&](int i) {
            return area.left() + area.width() * i / double(m_values.size() - 1);
        };
        auto yAt = [&](double v) {
            return area.bottom() - area.height() * (v - lo) / (hi - lo);
        };

        // The starting balance, so profit and loss are read against the line
        // that matters rather than against the bottom of the box.
        p.setPen(QPen(QColor(t.dim), 1, Qt::DashLine));
        p.drawLine(QPointF(area.left(), yAt(m_start)), QPointF(area.right(), yAt(m_start)));

        QPainterPath path;
        path.moveTo(xAt(0), yAt(m_values.first()));
        for (int i = 1; i < m_values.size(); ++i) path.lineTo(xAt(i), yAt(m_values[i]));
        const bool up = m_values.last() >= m_start;
        p.setPen(QPen(QColor(up ? t.up : t.down), 2));
        p.drawPath(path);
    }

private:
    QVector<double> m_values;
    double m_start = 0.0;
};

}  // namespace

StrategyTesterDialog::StrategyTesterDialog(ApiClient* api, QWidget* parent)
    : QDialog(parent), m_api(api), m_tester(new StrategyTester(this)) {
    setWindowTitle(tr("Strategy Tester"));
    setModal(false);
    resize(780, 680);

    const auto& p = Theme::p();
    setStyleSheet(QString(
        "QDialog { background:%1; }"
        "QLabel { color:%2; }"
        "QComboBox, QSpinBox, QDoubleSpinBox { background:%3; color:%2;"
        "    border:1px solid %4; border-radius:6px; padding:5px 7px; }"
        "QPlainTextEdit { background:%5; color:%2; border:1px solid %4;"
        "    border-radius:6px; font-family:Consolas,monospace; font-size:12px; }")
        .arg(p.bg, p.text, p.inputBg, p.inputBorder, p.tableBg));

    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(14, 12, 14, 12);
    root->setSpacing(10);

    auto* intro = new QLabel(
        tr("Runs a script's onBar(bar) function over historical bars. One "
           "position at a time; fills at each bar's close, spread and "
           "commission charged. See the log for what a run assumed."));
    intro->setWordWrap(true);
    intro->setStyleSheet(QString("color:%1; font-size:12px;").arg(p.muted));
    root->addWidget(intro);

    // ── settings ──
    auto* form = new QFormLayout;
    form->setHorizontalSpacing(14);
    form->setVerticalSpacing(8);

    m_script = new QComboBox;
    form->addRow(tr("Strategy"), m_script);

    m_symbol = new QComboBox;
    m_symbol->setEditable(true);
    form->addRow(tr("Symbol"), m_symbol);

    m_timeframe = new QComboBox;
    m_timeframe->addItems({"1m", "5m", "15m", "30m", "1h", "4h", "1d"});
    m_timeframe->setCurrentText(QStringLiteral("1h"));
    form->addRow(tr("Timeframe"), m_timeframe);

    m_bars = new QSpinBox;
    // The algo gateway caps a bars request at 1000 per (symbol, timeframe),
    // so offering more would promise history the server will not send.
    m_bars->setRange(50, 1000);
    m_bars->setValue(500);
    form->addRow(tr("Bars"), m_bars);

    m_balance = new QDoubleSpinBox;
    m_balance->setRange(1.0, 100000000.0);
    m_balance->setDecimals(2);
    m_balance->setValue(10000.0);
    form->addRow(tr("Starting balance"), m_balance);

    m_spread = new QDoubleSpinBox;
    m_spread->setRange(0.0, 10000.0);
    m_spread->setDecimals(1);
    m_spread->setSuffix(tr(" points"));
    form->addRow(tr("Spread"), m_spread);

    m_commission = new QDoubleSpinBox;
    m_commission->setRange(0.0, 1000.0);
    m_commission->setDecimals(2);
    m_commission->setPrefix(tr("$ "));
    form->addRow(tr("Commission per lot / side"), m_commission);

    root->addLayout(form);

    auto* buttons = new QHBoxLayout;
    m_runBtn = new QPushButton(tr("Run test"));
    m_runBtn->setCursor(Qt::PointingHandCursor);
    m_runBtn->setDefault(true);
    connect(m_runBtn, &QPushButton::clicked, this, &StrategyTesterDialog::runTest);
    m_reportBtn = new QPushButton(tr("Full report…"));
    m_reportBtn->setCursor(Qt::PointingHandCursor);
    m_reportBtn->setEnabled(false);
    connect(m_reportBtn, &QPushButton::clicked, this, [this]() {
        AccountInfo synthetic;
        synthetic.currency = QStringLiteral("$");
        synthetic.balance  = m_lastResult.finalBalance;
        // The same tables View > Reports draws for live trading, over the
        // simulated trades.
        ReportsDialog dlg(m_lastResult.trades, synthetic, ReportsDialog::Summary, this);
        dlg.exec();
    });
    buttons->addWidget(m_runBtn);
    buttons->addWidget(m_reportBtn);
    buttons->addStretch(1);
    root->addLayout(buttons);

    m_headline = new QLabel(tr("No test run yet."));
    m_headline->setWordWrap(true);
    m_headline->setStyleSheet(QString("color:%1; font-size:13px; font-weight:700;")
                              .arg(p.textStrong));
    root->addWidget(m_headline);

    m_curve = new EquityCurve;
    root->addWidget(m_curve);

    m_log = new QPlainTextEdit;
    m_log->setReadOnly(true);
    m_log->setMaximumHeight(150);
    root->addWidget(m_log);

    connect(m_tester, &StrategyTester::logged, this, &StrategyTesterDialog::appendLog);
    connect(m_api, &ApiClient::barsReceived, this, &StrategyTesterDialog::onBars);

    // barsReceived is emitted ONLY on success, so a failed fetch would leave
    // the dialog waiting for a reply that is never coming — Run disabled for
    // the rest of the session. Both an error and a timeout have to release it.
    // Matched by tag: errorOccurred's context is a display string ("Loading
    // chart for …"), never "bars", so this release used to never fire and a
    // failed load sat out the 30-second timeout.
    connect(m_api, &ApiClient::barsFailed, this,
            [this](const QString& tag, const QString& message) {
        if (!m_awaitingBars || tag != m_barsTag) return;
        m_awaitingBars = false;
        m_runBtn->setEnabled(true);
        appendLog(tr("✕ could not load history: %1").arg(message));
    });

    // The backstop for a request that neither answers nor errors — a dropped
    // connection usually does exactly that.
    m_timeout = new QTimer(this);
    m_timeout->setSingleShot(true);
    m_timeout->setInterval(30000);
    connect(m_timeout, &QTimer::timeout, this, [this]() {
        if (!m_awaitingBars) return;
        m_awaitingBars = false;
        m_runBtn->setEnabled(true);
        appendLog(tr("✕ timed out waiting for history. Check the connection and "
                     "try again."));
    });

    reloadScripts();
}

void StrategyTesterDialog::reloadScripts() {
    const QString keep = m_script->currentText();
    m_script->clear();
    QDir dir(scriptsDir());
    m_script->addItems(dir.entryList({"*.js"}, QDir::Files, QDir::Name));
    if (m_script->count() == 0)
        appendLog(tr("No scripts yet — write one in Insert > Scripts first. "
                     "A strategy needs an onBar(bar) function."));
    const int i = m_script->findText(keep);
    if (i >= 0) m_script->setCurrentIndex(i);
}

void StrategyTesterDialog::setSymbols(const QHash<QString, SymbolSpec>& specs) {
    m_specs = specs;
    const QString keep = m_symbol->currentText();
    QStringList names = specs.keys();
    std::sort(names.begin(), names.end());
    m_symbol->clear();
    m_symbol->addItems(names);
    if (!keep.isEmpty()) m_symbol->setCurrentText(keep);
}

void StrategyTesterDialog::appendLog(const QString& line) {
    m_log->appendPlainText(
        QString("%1  %2").arg(QDateTime::currentDateTime().toString("HH:mm:ss"), line));
}

void StrategyTesterDialog::runTest() {
    if (m_awaitingBars) return;

    // Scripts may have been added since the window opened.
    reloadScripts();
    if (m_script->currentText().isEmpty()) return;

    const QString symbol = m_symbol->currentText().trimmed().toUpper();
    if (symbol.isEmpty()) {
        appendLog(tr("✕ pick an instrument first"));
        return;
    }

    m_log->clear();
    appendLog(tr("Fetching %1 %2 bars of %3…")
                  .arg(m_bars->value()).arg(m_timeframe->currentText(), symbol));
    m_awaitingBars = true;
    m_runBtn->setEnabled(false);
    m_timeout->start();
    m_barsTag = QStringLiteral("st-%1").arg(QDateTime::currentMSecsSinceEpoch());
    m_api->fetchBars(symbol, m_timeframe->currentText(), m_bars->value(), 0, m_barsTag);
}

void StrategyTesterDialog::onBars(const QString& symbol, const QString& timeframe,
                                  const QVector<Bar>& bars, const QString& tag) {
    // Only the reply to this dialog's own request — the chart panes load the
    // same symbol and timeframe through the same signal.
    if (!m_awaitingBars || tag != m_barsTag) return;

    m_awaitingBars = false;
    m_timeout->stop();
    m_runBtn->setEnabled(true);

    QFile f(scriptsDir() + "/" + m_script->currentText());
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        appendLog(tr("✕ could not read %1").arg(m_script->currentText()));
        return;
    }
    const QString source = QString::fromUtf8(f.readAll());

    // Oldest first. The server answers newest-first and a strategy walked
    // backwards through time would be nonsense that still produced a number.
    QVector<Bar> ordered = bars;
    std::sort(ordered.begin(), ordered.end(),
              [](const Bar& a, const Bar& b) { return a.time < b.time; });

    const SymbolSpec spec = m_specs.value(symbol);
    StrategyTester::Settings s;
    s.symbol           = symbol;
    s.timeframe        = timeframe;
    s.startingBalance  = m_balance->value();
    s.spreadPoints     = m_spread->value();
    s.digits           = spec.digits > 0 ? spec.digits : 5;
    s.commissionPerLot = m_commission->value();
    s.contractSize     = spec.contractSize > 0.0 ? spec.contractSize : 100000.0;

    appendLog(tr("Testing %1 over %2 bars, %3 → %4.")
                  .arg(m_script->currentText())
                  .arg(ordered.size())
                  .arg(ordered.first().time.toString("yyyy-MM-dd"),
                       ordered.last().time.toString("yyyy-MM-dd")));

    showResult(m_tester->run(source, ordered, s));
}

void StrategyTesterDialog::showResult(const StrategyTester::Result& r) {
    m_lastResult = r;
    m_reportBtn->setEnabled(r.ok && !r.trades.isEmpty());

    if (!r.ok) {
        appendLog(tr("✕ ") + r.error);
        m_headline->setText(tr("Test failed — see the log."));
        static_cast<EquityCurve*>(m_curve)->setSeries({}, 0.0);
        return;
    }

    const double net = r.finalBalance - r.startingBalance;
    int won = 0;
    for (const HistoryTrade& t : r.trades)
        if (t.profit + t.swap + t.commission >= 0.0) ++won;

    if (r.trades.isEmpty()) {
        m_headline->setText(tr("%1 bars tested — the strategy never opened a trade.")
                                .arg(r.barsTested));
    } else {
        m_headline->setText(
            tr("%1 trades over %2 bars · net %3%L4 · %5 won (%L6%) · "
               "balance %L7 → %L8")
                .arg(r.trades.size())
                .arg(r.barsTested)
                .arg(net >= 0.0 ? "+" : "-")
                .arg(qAbs(net), 0, 'f', 2)
                .arg(won)
                .arg(100.0 * won / r.trades.size(), 0, 'f', 1)
                .arg(r.startingBalance, 0, 'f', 2)
                .arg(r.finalBalance, 0, 'f', 2));
    }
    appendLog(tr("Done. Press \"Full report…\" for the detailed statistics."));
    static_cast<EquityCurve*>(m_curve)->setSeries(r.equity, r.startingBalance);
}
