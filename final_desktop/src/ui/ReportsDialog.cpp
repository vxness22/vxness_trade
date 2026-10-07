#include "ui/ReportsDialog.h"
#include "ui/Theme.h"

#include <QDialogButtonBox>
#include <QHeaderView>
#include <QLabel>
#include <QMap>
#include <QTabWidget>
#include <QTableWidget>
#include <QVBoxLayout>

#include <algorithm>
#include <cmath>

namespace {

// Trades in close order, which is the order an equity curve has to be walked
// in. The server returns history newest-first, and a drawdown computed on that
// order would be the curve run backwards.
QVector<HistoryTrade> inCloseOrder(const QVector<HistoryTrade>& trades) {
    QVector<HistoryTrade> out = trades;
    std::stable_sort(out.begin(), out.end(),
                     [](const HistoryTrade& a, const HistoryTrade& b) {
        return a.closedAt < b.closedAt;   // ISO-8601 sorts correctly as text
    });
    return out;
}

// Net of the costs, which is what a trader means by what a trade made.
//
// Swap and commission are ADDED, not subtracted: the server already sends them
// signed, so a commission arrives as a negative number. This matches the
// account statement the blotter exports (PositionsPanel::historyReportHtml),
// and it has to — the two are shown side by side and a report that disagreed
// with the History tab would be worse than no report.
double net(const HistoryTrade& t) {
    return t.profit + t.swap + t.commission;
}

}  // namespace

ReportsDialog::Stats ReportsDialog::compute(const QVector<HistoryTrade>& trades) {
    Stats s;
    const QVector<HistoryTrade> ordered = inCloseOrder(trades);

    double running = 0.0;    // cumulative net profit
    double peak    = 0.0;    // highest the running total has been
    int    consecW = 0, consecL = 0;
    double consecWMoney = 0.0, consecLMoney = 0.0;

    for (const HistoryTrade& t : ordered) {
        const double p = net(t);
        ++s.trades;
        s.swap       += t.swap;
        s.commission += t.commission;

        if (p >= 0.0) {
            ++s.won;
            s.grossProfit += p;
            s.largestWin = qMax(s.largestWin, p);
            ++consecW;
            consecWMoney += p;
            if (consecW > s.maxConsecWins) {
                s.maxConsecWins = consecW;
                s.maxConsecWinMoney = consecWMoney;
            }
            consecL = 0;
            consecLMoney = 0.0;
        } else {
            ++s.lost;
            s.grossLoss += -p;
            s.largestLoss = qMin(s.largestLoss, p);
            ++consecL;
            consecLMoney += -p;
            if (consecL > s.maxConsecLosses) {
                s.maxConsecLosses = consecL;
                s.maxConsecLossMoney = consecLMoney;
            }
            consecW = 0;
            consecWMoney = 0.0;
        }

        running += p;
        peak = qMax(peak, running);
        // Absolute drawdown: how far below the STARTING point the curve ever
        // went. Maximal drawdown: the largest fall from any peak, which is the
        // one that describes the risk actually taken.
        s.absoluteDrawdown = qMax(s.absoluteDrawdown, -running);
        const double fall = peak - running;
        if (fall > s.maxDrawdown) {
            s.maxDrawdown = fall;
            // As a percentage OF THE PEAK it fell from, which is the
            // conventional reading. A peak of zero has no percentage.
            s.maxDrawdownPct = peak > 0.0 ? 100.0 * fall / peak : 0.0;
        }
    }
    if (s.absoluteDrawdown < 0.0) s.absoluteDrawdown = 0.0;
    return s;
}

ReportsDialog::ReportsDialog(const QVector<HistoryTrade>& history,
                             const AccountInfo& account, Tab tab, QWidget* parent)
    : QDialog(parent), m_currency(account.currency) {
    setWindowTitle(tr("Reports"));
    setModal(true);
    resize(620, 560);

    const auto& p = Theme::p();
    setStyleSheet(QString(
        "QDialog { background:%1; }"
        "QLabel { color:%2; }"
        "QTableWidget { background:%3; color:%2; border:1px solid %4;"
        "               gridline-color:%4; }"
        "QHeaderView::section { background:%5; color:%6; border:none;"
        "                       padding:5px 6px; font-weight:700; }")
        .arg(p.bg, p.text, p.tableBg, p.border, p.headerBg, p.muted));

    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(14, 12, 14, 12);
    root->setSpacing(10);

    if (history.isEmpty()) {
        auto* empty = new QLabel(tr("No closed trades yet — a report needs "
                                    "closed positions to describe."));
        empty->setWordWrap(true);
        empty->setStyleSheet(QString("color:%1; font-size:13px;").arg(p.muted));
        root->addWidget(empty, 1);
        auto* close = new QDialogButtonBox(QDialogButtonBox::Close);
        connect(close, &QDialogButtonBox::rejected, this, &QDialog::reject);
        root->addWidget(close);
        return;
    }

    m_tabs = new QTabWidget;
    m_tabs->addTab(buildSummary(history),   tr("Summary"));
    m_tabs->addTab(buildRisk(history),      tr("Risk"));
    m_tabs->addTab(buildLongShort(history), tr("Long && Short"));
    m_tabs->addTab(buildSymbols(history),   tr("Symbols"));
    m_tabs->setCurrentIndex(static_cast<int>(tab));
    root->addWidget(m_tabs, 1);

    auto* note = new QLabel(
        tr("Figures are net of swap and commission, over every closed trade on "
           "this account."));
    note->setWordWrap(true);
    note->setStyleSheet(QString("color:%1; font-size:11px;").arg(p.muted));
    root->addWidget(note);

    auto* close = new QDialogButtonBox(QDialogButtonBox::Close);
    connect(close, &QDialogButtonBox::rejected, this, &QDialog::reject);
    root->addWidget(close);
}

// ── formatting ──────────────────────────────────────────────────────────────

QString ReportsDialog::money(double v) const {
    const QString c = m_currency.isEmpty() ? QStringLiteral("$") : m_currency + " ";
    return QString("%1%2%L3").arg(v > 0.0 ? "+" : v < 0.0 ? "-" : "", c)
                             .arg(std::fabs(v), 0, 'f', 2);
}

QString ReportsDialog::percent(double v) const {
    return QString("%L1%").arg(v, 0, 'f', 2);
}

QString ReportsDialog::ratio(double v) const {
    return v > 0.0 ? QString("%L1").arg(v, 0, 'f', 2) : QStringLiteral("—");
}

QTableWidget* ReportsDialog::sheet(const QVector<QPair<QString, QString>>& rows) {
    auto* t = new QTableWidget(rows.size(), 2);
    t->setHorizontalHeaderLabels({tr("Measure"), tr("Value")});
    t->verticalHeader()->setVisible(false);
    t->setEditTriggers(QAbstractItemView::NoEditTriggers);
    t->setSelectionMode(QAbstractItemView::NoSelection);
    t->setAlternatingRowColors(true);
    t->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
    t->horizontalHeader()->setSectionResizeMode(1, QHeaderView::ResizeToContents);

    for (int i = 0; i < rows.size(); ++i) {
        t->setItem(i, 0, new QTableWidgetItem(rows[i].first));
        auto* v = new QTableWidgetItem(rows[i].second);
        v->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
        t->setItem(i, 1, v);
    }
    return t;
}

// ── tabs ────────────────────────────────────────────────────────────────────

QWidget* ReportsDialog::buildSummary(const QVector<HistoryTrade>& h) {
    const Stats s = compute(h);
    return sheet({
        {tr("Total net profit"),   money(s.netProfit())},
        {tr("Gross profit"),       money(s.grossProfit)},
        {tr("Gross loss"),         money(-s.grossLoss)},
        {tr("Profit factor"),      ratio(s.profitFactor())},
        {tr("Expected payoff"),    money(s.expectedPayoff())},
        {tr("Total trades"),       QString::number(s.trades)},
        {tr("Profit trades"),      tr("%1  (%2)").arg(s.won).arg(percent(s.winRate()))},
        {tr("Loss trades"),        tr("%1  (%2)").arg(s.lost)
                                       .arg(percent(s.trades ? 100.0 * s.lost / s.trades : 0.0))},
        {tr("Largest profit trade"), money(s.largestWin)},
        {tr("Largest loss trade"),   money(s.largestLoss)},
        {tr("Average profit trade"), money(s.averageWin())},
        {tr("Average loss trade"),   money(-s.averageLoss())},
        {tr("Swap"),               money(s.swap)},
        {tr("Commission"),         money(s.commission)},
    });
}

QWidget* ReportsDialog::buildRisk(const QVector<HistoryTrade>& h) {
    const Stats s = compute(h);
    // Reward-to-risk: what an average win returns against what an average loss
    // costs. Undefined with no losing trade, which ratio() renders as a dash
    // rather than as an impressive-looking zero.
    const double rr = s.averageLoss() > 0.0 ? s.averageWin() / s.averageLoss() : 0.0;
    return sheet({
        {tr("Absolute drawdown"),  money(-s.absoluteDrawdown)},
        {tr("Maximal drawdown"),   QString("%1  (%2)").arg(money(-s.maxDrawdown),
                                                           percent(s.maxDrawdownPct))},
        {tr("Recovery factor"),    ratio(s.recoveryFactor())},
        {tr("Profit factor"),      ratio(s.profitFactor())},
        {tr("Reward / risk"),      ratio(rr)},
        {tr("Win rate"),           percent(s.winRate())},
        {tr("Largest loss trade"), money(s.largestLoss)},
        {tr("Average loss trade"), money(-s.averageLoss())},
        {tr("Maximum consecutive losses"),
             tr("%1  (%2)").arg(s.maxConsecLosses).arg(money(-s.maxConsecLossMoney))},
        {tr("Maximum consecutive wins"),
             tr("%1  (%2)").arg(s.maxConsecWins).arg(money(s.maxConsecWinMoney))},
    });
}

QWidget* ReportsDialog::buildLongShort(const QVector<HistoryTrade>& h) {
    QVector<HistoryTrade> longs, shorts;
    for (const HistoryTrade& t : h) {
        // The server spells the side "buy"/"sell"; anything else is treated as
        // long rather than silently dropped from both halves of the report.
        if (t.side.compare(QStringLiteral("sell"), Qt::CaseInsensitive) == 0) shorts << t;
        else                                                                  longs  << t;
    }
    const Stats l = compute(longs);
    const Stats sh = compute(shorts);

    struct Row { QString label; QString longValue; QString shortValue; };
    const QVector<Row> rows = {
        {tr("Trades"),        QString::number(l.trades),   QString::number(sh.trades)},
        {tr("Won"),           tr("%1  (%2)").arg(l.won).arg(percent(l.winRate())),
                              tr("%1  (%2)").arg(sh.won).arg(percent(sh.winRate()))},
        {tr("Net profit"),    money(l.netProfit()),        money(sh.netProfit())},
        {tr("Gross profit"),  money(l.grossProfit),        money(sh.grossProfit)},
        {tr("Gross loss"),    money(-l.grossLoss),         money(-sh.grossLoss)},
        {tr("Profit factor"), ratio(l.profitFactor()),     ratio(sh.profitFactor())},
        {tr("Expected payoff"), money(l.expectedPayoff()), money(sh.expectedPayoff())},
    };

    auto* t = new QTableWidget(rows.size(), 3);
    t->setHorizontalHeaderLabels({tr("Measure"), tr("Long"), tr("Short")});
    t->verticalHeader()->setVisible(false);
    t->setEditTriggers(QAbstractItemView::NoEditTriggers);
    t->setSelectionMode(QAbstractItemView::NoSelection);
    t->setAlternatingRowColors(true);
    t->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
    t->horizontalHeader()->setSectionResizeMode(1, QHeaderView::ResizeToContents);
    t->horizontalHeader()->setSectionResizeMode(2, QHeaderView::ResizeToContents);

    for (int i = 0; i < rows.size(); ++i) {
        t->setItem(i, 0, new QTableWidgetItem(rows[i].label));
        for (int c = 1; c <= 2; ++c) {
            auto* v = new QTableWidgetItem(c == 1 ? rows[i].longValue : rows[i].shortValue);
            v->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
            t->setItem(i, c, v);
        }
    }
    return t;
}

QWidget* ReportsDialog::buildSymbols(const QVector<HistoryTrade>& h) {
    // QMap so the instruments come out alphabetically without a second sort.
    QMap<QString, QVector<HistoryTrade>> bySymbol;
    for (const HistoryTrade& t : h) bySymbol[t.symbol].append(t);

    auto* t = new QTableWidget(bySymbol.size(), 6);
    t->setHorizontalHeaderLabels({tr("Symbol"), tr("Trades"), tr("Won"),
                                  tr("Net profit"), tr("Profit factor"), tr("Lots")});
    t->verticalHeader()->setVisible(false);
    t->setEditTriggers(QAbstractItemView::NoEditTriggers);
    t->setSelectionMode(QAbstractItemView::NoSelection);
    t->setAlternatingRowColors(true);
    t->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
    for (int c = 1; c < 6; ++c)
        t->horizontalHeader()->setSectionResizeMode(c, QHeaderView::ResizeToContents);

    const auto& pal = Theme::p();
    int r = 0;
    for (auto it = bySymbol.cbegin(); it != bySymbol.cend(); ++it, ++r) {
        const Stats s = compute(it.value());
        double lots = 0.0;
        for (const HistoryTrade& trade : it.value()) lots += trade.lots;

        t->setItem(r, 0, new QTableWidgetItem(it.key()));
        const QStringList values = {
            QString::number(s.trades),
            tr("%1  (%2)").arg(s.won).arg(percent(s.winRate())),
            money(s.netProfit()),
            ratio(s.profitFactor()),
            QString::number(lots, 'f', 2),
        };
        for (int c = 0; c < values.size(); ++c) {
            auto* item = new QTableWidgetItem(values[c]);
            item->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
            // Only the money column is coloured. Colouring every figure would
            // make the table read as a heat map rather than as a statement.
            if (c == 2)
                item->setForeground(QColor(s.netProfit() > 0.0 ? pal.up
                                         : s.netProfit() < 0.0 ? pal.down : pal.text));
            t->setItem(r, c + 1, item);
        }
    }
    return t;
}
