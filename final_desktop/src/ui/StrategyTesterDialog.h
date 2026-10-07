#pragma once
#include <QDialog>
#include <QHash>
#include <QVector>
#include "core/Models.h"
#include "core/StrategyTester.h"

class ApiClient;
class QComboBox;
class QSpinBox;
class QDoubleSpinBox;
class QPushButton;
class QPlainTextEdit;
class QLabel;
class QTableWidget;
class QWidget;
class QTimer;

// View > Strategy Tester.
//
// Picks a script, an instrument, a timeframe and a bar count, fetches that
// history from the same endpoint the charts use, and runs the strategy over it
// — see StrategyTester for exactly what the simulation does and does not model.
//
// The result is shown three ways: a headline summary, an equity curve, and a
// full report in the same tables View > Reports uses for real trading. That
// last one is the point of producing HistoryTrade records rather than a
// bespoke result type — the statistics are computed by the same code either
// way, so a backtest and a track record can be read side by side.
class StrategyTesterDialog : public QDialog {
    Q_OBJECT
public:
    StrategyTesterDialog(ApiClient* api, QWidget* parent = nullptr);

    // The instrument table, for the symbol picker and its digits / contract
    // size, which the fill model needs.
    void setSymbols(const QHash<QString, SymbolSpec>& specs);

private:
    void runTest();
    void onBars(const QString& symbol, const QString& timeframe,
                const QVector<Bar>& bars, const QString& tag);
    void showResult(const StrategyTester::Result& r);
    void appendLog(const QString& line);
    void reloadScripts();

    ApiClient*      m_api;
    StrategyTester* m_tester;

    QComboBox*      m_script;
    QComboBox*      m_symbol;
    QComboBox*      m_timeframe;
    QSpinBox*       m_bars;
    QDoubleSpinBox* m_balance;
    QDoubleSpinBox* m_lotHint;     // shown to the strategy author, not enforced
    QDoubleSpinBox* m_spread;
    QDoubleSpinBox* m_commission;
    QPushButton*    m_runBtn;
    QPushButton*    m_reportBtn;
    QLabel*         m_headline;
    QWidget*        m_curve;       // paints m_lastResult.equity
    QPlainTextEdit* m_log;

    QHash<QString, SymbolSpec> m_specs;
    // True between asking for bars and getting them, so a second Run cannot
    // start a test while the first is still waiting on history.
    bool m_awaitingBars = false;
    QString m_barsTag;             // the /bars request this dialog is waiting on
    // Releases the Run button when a history request neither answers nor
    // errors — see the connection in the constructor.
    QTimer* m_timeout = nullptr;
    StrategyTester::Result m_lastResult;
};
