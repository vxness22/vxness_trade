#pragma once
#include <QDialog>
#include <QVector>
#include "core/Models.h"

class QTabWidget;
class QTableWidget;
class QLabel;

// View > Reports — MT5's Reports, in the app rather than as an export.
//
// Four tabs, as the desk specified: Summary, Risk, Long & Short, and Symbols.
// All four are computed from the closed trades the blotter already holds, so
// they can never disagree with the History tab, and opening a report costs no
// round trip.
//
// Deliberately read-only tables rather than the HTML statement the panel can
// already save. The statement is the document a trader sends to an accountant;
// this is the thing they glance at between trades, and it opens on the tab they
// asked for instead of in a browser.
class ReportsDialog : public QDialog {
    Q_OBJECT
public:
    // `tab` selects which report opens, so View > Reports > Risk lands on Risk.
    enum Tab { Summary = 0, Risk, LongShort, Symbols };

    ReportsDialog(const QVector<HistoryTrade>& history, const AccountInfo& account,
                  Tab tab, QWidget* parent = nullptr);

private:
    // Everything the four tabs are built from, computed once. Split out because
    // three of the tabs need the same underlying figures for a different slice
    // of the trades.
    struct Stats {
        int    trades = 0, won = 0, lost = 0;
        double grossProfit = 0.0;    // sum of winning trades
        double grossLoss   = 0.0;    // sum of losing trades, as a POSITIVE number
        double swap = 0.0, commission = 0.0;
        double largestWin = 0.0, largestLoss = 0.0;   // largestLoss is negative
        // Equity-curve figures. Drawdown is measured on the running total of
        // net profit, in trade-close order — which is what MT5 reports and the
        // only drawdown derivable without a balance snapshot per trade.
        double absoluteDrawdown = 0.0;
        double maxDrawdown = 0.0, maxDrawdownPct = 0.0;
        int    maxConsecWins = 0, maxConsecLosses = 0;
        double maxConsecWinMoney = 0.0, maxConsecLossMoney = 0.0;

        double netProfit()     const { return grossProfit - grossLoss; }
        // Infinite when nothing was lost; the caller renders that as an em dash
        // rather than printing "inf".
        double profitFactor()  const { return grossLoss > 0.0 ? grossProfit / grossLoss : 0.0; }
        double expectedPayoff() const { return trades > 0 ? netProfit() / trades : 0.0; }
        double averageWin()    const { return won  > 0 ? grossProfit / won  : 0.0; }
        double averageLoss()   const { return lost > 0 ? grossLoss   / lost : 0.0; }
        double recoveryFactor() const {
            return maxDrawdown > 0.0 ? netProfit() / maxDrawdown : 0.0;
        }
        double winRate() const { return trades > 0 ? 100.0 * won / trades : 0.0; }
    };

    static Stats compute(const QVector<HistoryTrade>& trades);

    QWidget* buildSummary(const QVector<HistoryTrade>& h);
    QWidget* buildRisk(const QVector<HistoryTrade>& h);
    QWidget* buildLongShort(const QVector<HistoryTrade>& h);
    QWidget* buildSymbols(const QVector<HistoryTrade>& h);

    // A two-column name/value sheet, the shape MT5 uses for Summary and Risk.
    QTableWidget* sheet(const QVector<QPair<QString, QString>>& rows);
    // Money in the account's currency, or an em dash when there is nothing to
    // say. Signed, because a report full of unsigned losses is unreadable.
    QString money(double v) const;
    QString percent(double v) const;
    // Profit factor and recovery factor are ratios that genuinely have no value
    // when the denominator is zero. "—" says that; "0.00" would be a lie.
    QString ratio(double v) const;

    QString     m_currency;
    QTabWidget* m_tabs = nullptr;   // never built when there is no history
};
