#pragma once
#include <QDialog>
#include <QHash>
#include "core/Models.h"

class ApiClient;
class ScriptEngine;
class QListWidget;
class QPlainTextEdit;
class QPushButton;
class QCheckBox;
class QLabel;

// Insert > Scripts — write, compile and run a trading script without leaving
// the terminal.
//
// The language is JavaScript, on Qt's own engine, rather than MQL. That is a
// deliberate choice and worth stating: MQL would mean writing a compiler, and
// a half-built one that mis-compiles a strategy is worse than no scripting at
// all, because the trader finds out through their balance. JavaScript gets a
// real, complete engine for free and every script here is code the trader can
// read back.
//
// Two shapes, matching MetaTrader's own split:
//   • top-level code runs once — a script;
//   • defining onTick(tick) keeps it running on every price update.
//
// Scripts are files in a `scripts` folder beside config.json, so they can be
// backed up, shared and edited outside the terminal.
class ScriptsDialog : public QDialog {
    Q_OBJECT
public:
    ScriptsDialog(ApiClient* api, QWidget* parent = nullptr);

    // Fed live by the window so a running script sees the same market, account
    // and positions as the screen does.
    void setQuotes(const QHash<QString, Quote>& quotes);
    void setAccount(const AccountInfo& account);
    void setPositions(const QVector<OpenPosition>& positions);
    void setSymbols(const QStringList& symbols);
    // One tick, handed to a live script's onTick.
    void deliverTick(const Quote& q);

    // True while a script is live and wants ticks. The window checks this
    // before forwarding every tick rather than calling into a stopped engine.
    bool isRunning() const;

protected:
    // Closing the window with a script still live would leave it trading with
    // nothing on screen to stop it.
    void closeEvent(QCloseEvent* e) override;

private:
    static QString scriptsDir();
    void reloadList();
    void openScript(const QString& name);
    bool saveCurrent();
    void newScript();
    void deleteCurrent();
    void compile();
    void runScript();
    void stopScript();
    void appendLog(const QString& line);
    void setRunning(bool running);

    ApiClient*      m_api;
    ScriptEngine*   m_engine;
    QListWidget*    m_list;
    QPlainTextEdit* m_editor;
    QPlainTextEdit* m_log;
    QPushButton*    m_compileBtn;
    QPushButton*    m_runBtn;
    QPushButton*    m_stopBtn;
    QPushButton*    m_saveBtn;
    QCheckBox*      m_simulate;
    QLabel*         m_status;
    QString         m_current;   // file name of the open script, "" if none
};
