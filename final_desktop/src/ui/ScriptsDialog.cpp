#include "ui/ScriptsDialog.h"
#include "core/ApiClient.h"
#include "core/ScriptEngine.h"
#include "ui/Theme.h"

#include <QCheckBox>
#include <QCloseEvent>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QLabel>
#include <QListWidget>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSplitter>
#include <QStandardPaths>
#include <QVBoxLayout>

namespace {

// What a brand-new script starts as. It runs and does something visible
// immediately, and it shows both shapes — the one-shot body and the optional
// onTick — because the difference between them is the thing that is not
// obvious from an empty editor.
const char* kTemplate = R"JS(// A Vxness script. Everything you can reach is on `terminal`.
//
//   terminal.log(text)
//   terminal.symbols()                 -> ["EURUSD", …]
//   terminal.bid(sym) / ask(sym) / spread(sym) / hasPrice(sym)
//   terminal.balance() / equity() / freeMargin() / currency()
//   terminal.positions()               -> [{id, symbol, side, lots, profit, …}]
//   terminal.buy(sym, lots, sl, tp, comment)
//   terminal.sell(sym, lots, sl, tp, comment)
//   terminal.closeAll(sym)
//
// Leave "Simulate" ticked while you are working on a script: orders are
// logged, not sent.

terminal.log("Balance: " + terminal.balance() + " " + terminal.currency());
terminal.log("Open positions: " + terminal.positions().length);

// Delete this function if you want the script to run once and stop.
// Keep it and the script stays live, called on every price update.
function onTick(tick) {
  if (tick.symbol !== "EURUSD") return;
  terminal.log(tick.symbol + "  bid " + tick.bid + "  ask " + tick.ask);
}
)JS";

}  // namespace

ScriptsDialog::ScriptsDialog(ApiClient* api, QWidget* parent)
    : QDialog(parent), m_api(api), m_engine(new ScriptEngine(api, this)) {
    setWindowTitle(tr("Scripts"));
    // Modeless: a live script has to keep running while the trader watches the
    // charts, and a modal window would block them.
    setModal(false);
    resize(920, 620);

    const auto& p = Theme::p();
    setStyleSheet(QString(
        "QDialog { background:%1; }"
        "QLabel { color:%2; }"
        "QListWidget, QPlainTextEdit { background:%3; color:%2;"
        "    border:1px solid %4; border-radius:6px; }"
        "QPlainTextEdit { font-family:Consolas,'Courier New',monospace; font-size:12px; }")
        .arg(p.bg, p.text, p.tableBg, p.border));

    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(12, 10, 12, 10);
    root->setSpacing(8);

    // ── toolbar ──
    auto* tools = new QHBoxLayout;
    tools->setSpacing(8);
    auto* newBtn = new QPushButton(tr("New"));
    auto* delBtn = new QPushButton(tr("Delete"));
    m_saveBtn    = new QPushButton(tr("Save"));
    m_compileBtn = new QPushButton(tr("Compile"));
    m_runBtn     = new QPushButton(tr("Run"));
    m_stopBtn    = new QPushButton(tr("Stop"));
    for (QPushButton* b : {newBtn, delBtn, m_saveBtn, m_compileBtn, m_runBtn, m_stopBtn})
        b->setCursor(Qt::PointingHandCursor);
    m_stopBtn->setEnabled(false);

    connect(newBtn,       &QPushButton::clicked, this, &ScriptsDialog::newScript);
    connect(delBtn,       &QPushButton::clicked, this, &ScriptsDialog::deleteCurrent);
    connect(m_saveBtn,    &QPushButton::clicked, this, [this]() { saveCurrent(); });
    connect(m_compileBtn, &QPushButton::clicked, this, &ScriptsDialog::compile);
    connect(m_runBtn,     &QPushButton::clicked, this, &ScriptsDialog::runScript);
    connect(m_stopBtn,    &QPushButton::clicked, this, &ScriptsDialog::stopScript);

    tools->addWidget(newBtn);
    tools->addWidget(delBtn);
    tools->addWidget(m_saveBtn);
    tools->addSpacing(12);
    tools->addWidget(m_compileBtn);
    tools->addWidget(m_runBtn);
    tools->addWidget(m_stopBtn);
    tools->addStretch(1);

    // Ticked by default, and the Run confirmation spells out what unticking it
    // means. A script is code written minutes ago against a real account.
    m_simulate = new QCheckBox(tr("Simulate (do not send real orders)"));
    m_simulate->setChecked(true);
    m_simulate->setCursor(Qt::PointingHandCursor);
    tools->addWidget(m_simulate);
    root->addLayout(tools);

    // ── list | editor / log ──
    auto* split = new QSplitter(Qt::Horizontal);

    m_list = new QListWidget;
    m_list->setMaximumWidth(220);
    connect(m_list, &QListWidget::currentTextChanged, this, [this](const QString& name) {
        if (!name.isEmpty() && name != m_current) openScript(name);
    });
    split->addWidget(m_list);

    auto* right = new QSplitter(Qt::Vertical);
    m_editor = new QPlainTextEdit;
    m_editor->setTabStopDistance(28);
    m_editor->setPlaceholderText(tr("Select a script, or press New."));
    right->addWidget(m_editor);

    m_log = new QPlainTextEdit;
    m_log->setReadOnly(true);
    m_log->setPlaceholderText(tr("Output appears here."));
    right->addWidget(m_log);
    right->setSizes({420, 180});
    split->addWidget(right);
    split->setStretchFactor(1, 1);
    root->addWidget(split, 1);

    m_status = new QLabel;
    m_status->setStyleSheet(QString("color:%1; font-size:12px;").arg(p.muted));
    root->addWidget(m_status);

    connect(m_engine, &ScriptEngine::logged, this, &ScriptsDialog::appendLog);
    connect(m_engine, &ScriptEngine::finished, this, [this](bool) { setRunning(false); });

    reloadList();
}

// ── storage ─────────────────────────────────────────────────────────────────

QString ScriptsDialog::scriptsDir() {
    QString dir = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    if (dir.isEmpty()) dir = QDir::homePath() + "/.vxness-terminal";
    dir += "/scripts";
    QDir().mkpath(dir);
    return dir;
}

void ScriptsDialog::reloadList() {
    const QString keep = m_current;
    m_list->clear();
    QDir dir(scriptsDir());
    for (const QString& f : dir.entryList({"*.js"}, QDir::Files, QDir::Name))
        m_list->addItem(f);

    if (!keep.isEmpty()) {
        const auto found = m_list->findItems(keep, Qt::MatchExactly);
        if (!found.isEmpty()) m_list->setCurrentItem(found.first());
    }
    m_status->setText(tr("%1 script(s) in %2").arg(m_list->count()).arg(scriptsDir()));
}

void ScriptsDialog::openScript(const QString& name) {
    QFile f(scriptsDir() + "/" + name);
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        appendLog(tr("✕ could not open %1").arg(name));
        return;
    }
    m_editor->setPlainText(QString::fromUtf8(f.readAll()));
    m_current = name;
}

bool ScriptsDialog::saveCurrent() {
    if (m_current.isEmpty()) {
        appendLog(tr("✕ nothing to save — press New first"));
        return false;
    }
    QFile f(scriptsDir() + "/" + m_current);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text)) {
        appendLog(tr("✕ could not write %1").arg(m_current));
        return false;
    }
    f.write(m_editor->toPlainText().toUtf8());
    appendLog(tr("Saved %1").arg(m_current));
    return true;
}

void ScriptsDialog::newScript() {
    bool ok = false;
    QString name = QInputDialog::getText(this, tr("New script"), tr("Name:"),
                                         QLineEdit::Normal, tr("my-script"), &ok).trimmed();
    if (!ok || name.isEmpty()) return;
    if (!name.endsWith(QStringLiteral(".js"), Qt::CaseInsensitive)) name += ".js";
    // The name becomes a file name, so anything that could walk out of the
    // scripts folder has to go. A trader typing "../config" is not an attack,
    // but it would still overwrite their session.
    name = QFileInfo(name).fileName();
    if (name.isEmpty()) return;

    if (QFile::exists(scriptsDir() + "/" + name)) {
        appendLog(tr("✕ %1 already exists").arg(name));
        return;
    }
    m_current = name;
    m_editor->setPlainText(QString::fromUtf8(kTemplate));
    if (!saveCurrent()) return;
    reloadList();
}

void ScriptsDialog::deleteCurrent() {
    if (m_current.isEmpty()) return;
    if (QMessageBox::question(this, tr("Delete script"),
                              tr("Delete \"%1\"? This cannot be undone.").arg(m_current),
                              QMessageBox::Yes | QMessageBox::No, QMessageBox::No)
        != QMessageBox::Yes)
        return;
    QFile::remove(scriptsDir() + "/" + m_current);
    appendLog(tr("Deleted %1").arg(m_current));
    m_current.clear();
    m_editor->clear();
    reloadList();
}

// ── compile / run ───────────────────────────────────────────────────────────

void ScriptsDialog::compile() {
    QString error;
    int line = 0;
    if (ScriptEngine::checkSyntax(m_editor->toPlainText(), &error, &line)) {
        appendLog(tr("✓ compiled — no syntax errors"));
        return;
    }
    appendLog(tr("✕ line %1: %2").arg(line).arg(error));
}

void ScriptsDialog::runScript() {
    const QString source = m_editor->toPlainText();
    if (source.trimmed().isEmpty()) return;

    // Never half-run a script with a typo in it: the top-level statements
    // before the bad line would already have traded.
    QString error;
    int line = 0;
    if (!ScriptEngine::checkSyntax(source, &error, &line)) {
        appendLog(tr("✕ line %1: %2").arg(line).arg(error));
        appendLog(tr("Not run — fix the error above first."));
        return;
    }

    const bool simulate = m_simulate->isChecked();
    if (!simulate) {
        // The one place this is spelled out. Everything above is reversible;
        // this is not.
        const auto answer = QMessageBox::warning(
            this, tr("Run against the live account"),
            tr("\"Simulate\" is off, so this script can place REAL orders on your "
               "trading account and spend real money.\n\n"
               "Run \"%1\" for real?").arg(m_current.isEmpty() ? tr("this script")
                                                               : m_current),
            QMessageBox::Yes | QMessageBox::Cancel, QMessageBox::Cancel);
        if (answer != QMessageBox::Yes) {
            appendLog(tr("Cancelled — nothing was run."));
            return;
        }
    }

    if (!m_current.isEmpty()) saveCurrent();
    m_engine->api()->setSimulated(simulate);
    m_log->clear();
    appendLog(tr("— %1 —").arg(simulate ? tr("running, simulated")
                                        : tr("running, LIVE ORDERS")));
    setRunning(true);
    // run() emits finished() itself for a script that does not want ticks, and
    // that is what puts the buttons back.
    m_engine->run(source);
}

void ScriptsDialog::stopScript() {
    m_engine->stop();
    setRunning(false);
    const int sent = m_engine->api()->ordersPlaced();
    if (sent > 0) appendLog(tr("%1 order(s) were sent during this run.").arg(sent));
}

void ScriptsDialog::setRunning(bool running) {
    m_runBtn->setEnabled(!running);
    m_stopBtn->setEnabled(running);
    m_compileBtn->setEnabled(!running);
    m_simulate->setEnabled(!running);
    m_editor->setReadOnly(running);
}

void ScriptsDialog::appendLog(const QString& line) {
    m_log->appendPlainText(
        QString("%1  %2").arg(QDateTime::currentDateTime().toString("HH:mm:ss"), line));
}

// ── live feeds ──────────────────────────────────────────────────────────────

bool ScriptsDialog::isRunning() const { return m_engine->isLive(); }

void ScriptsDialog::setQuotes(const QHash<QString, Quote>& q) { m_engine->api()->setQuotes(q); }
void ScriptsDialog::setAccount(const AccountInfo& a)          { m_engine->api()->setAccount(a); }
void ScriptsDialog::setPositions(const QVector<OpenPosition>& p) {
    m_engine->api()->setPositions(p);
}
void ScriptsDialog::setSymbols(const QStringList& s) { m_engine->api()->setSymbols(s); }

void ScriptsDialog::deliverTick(const Quote& q) { m_engine->deliverTick(q); }

void ScriptsDialog::closeEvent(QCloseEvent* e) {
    if (m_engine->isLive()) {
        const auto answer = QMessageBox::question(
            this, tr("Script still running"),
            tr("\"%1\" is still live. Stop it and close?")
                .arg(m_current.isEmpty() ? tr("The script") : m_current),
            QMessageBox::Yes | QMessageBox::No, QMessageBox::Yes);
        if (answer != QMessageBox::Yes) {
            e->ignore();
            return;
        }
        m_engine->stop();
    }
    QDialog::closeEvent(e);
}
