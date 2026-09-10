#include "ui/SymbolSpecDialog.h"
#include "ui/Theme.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QPushButton>
#include <QTableWidget>
#include <QHeaderView>
#include <QFont>
#include <QLocale>
#include <cmath>

// A volume, printed at the precision the instrument's own lot step implies:
// 0.01 steps read as "0.01", whole-lot steps as "1". Padding every size to two
// decimals makes an instrument that only trades whole lots look like it takes
// fractions of one.
static QString lots(double v, double step) {
    const int dp = (step > 0.0 && step < 1.0) ? 2 : (v < 1.0 ? 2 : 0);
    return QLocale::system().toString(v, 'f', dp);
}

// Contract size and similar counts: grouped, and without a decimal tail when
// there is nothing after the point. "100,000" not "100000.00".
static QString grouped(double v) {
    const bool whole = std::fabs(v - std::round(v)) < 1e-9;
    return QLocale::system().toString(v, 'f', whole ? 0 : 2);
}

SymbolSpecDialog::SymbolSpecDialog(const SymbolSpec& spec, const Quote& quote, QWidget* parent)
    : QDialog(parent), m_spec(spec), m_quote(quote) {
    setWindowTitle(tr("%1 — Specification").arg(spec.symbol));
    setModal(true);
    resize(430, 600);

    m_heading = new QLabel;
    m_note    = new QLabel;
    m_note->setWordWrap(true);

    m_table = new QTableWidget(0, 2, this);
    m_table->horizontalHeader()->setVisible(false);
    m_table->verticalHeader()->setVisible(false);
    m_table->setEditTriggers(QAbstractItemView::NoEditTriggers);
    // A property sheet is read, not operated. Selection highlighting would
    // suggest a row does something when clicked, and none of them do.
    m_table->setSelectionMode(QAbstractItemView::NoSelection);
    m_table->setFocusPolicy(Qt::NoFocus);
    m_table->setShowGrid(false);
    m_table->setWordWrap(false);
    m_table->verticalHeader()->setDefaultSectionSize(22);
    m_table->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
    m_table->horizontalHeader()->setSectionResizeMode(1, QHeaderView::ResizeToContents);
    m_table->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);

    addSection(tr("Instrument"));
    addRow("symbol",      tr("Symbol"),      m_spec.symbol);
    addRow("description", tr("Description"), m_spec.displayName.isEmpty() ? m_spec.symbol
                                                                          : m_spec.displayName);
    addRow("category",    tr("Category"),    m_spec.category.isEmpty() ? tr("—") : m_spec.category);

    addSection(tr("Price"));
    addRow("bid",     tr("Bid"),            tr("—"));
    addRow("ask",     tr("Ask"),            tr("—"));
    addRow("spread",  tr("Spread, current"), tr("—"));
    addRow("digits",  tr("Digits"),         QString::number(m_spec.digits));
    addRow("pip",     tr("Pip size"),       tr("loading…"));

    addSection(tr("Trading"));
    addRow("contract", tr("Contract size"),   grouped(m_spec.contractSize));
    addRow("minLot",   tr("Minimum volume"),  lots(m_spec.minLot,  m_spec.lotStep));
    addRow("maxLot",   tr("Maximum volume"),  lots(m_spec.maxLot,  m_spec.lotStep));
    addRow("lotStep",  tr("Volume step"),     lots(m_spec.lotStep, m_spec.lotStep));
    addRow("spreadCfg", tr("Spread, charged"), tr("loading…"));
    addRow("commission", tr("Commission"),    tr("loading…"));

    addSection(tr("Overnight"));
    addRow("swapLong",  tr("Swap long"),  tr("loading…"));
    addRow("swapShort", tr("Swap short"), tr("loading…"));

    auto* close = new QPushButton(tr("Close"));
    close->setMinimumHeight(32);
    close->setCursor(Qt::PointingHandCursor);
    connect(close, &QPushButton::clicked, this, &QDialog::accept);

    auto* actions = new QHBoxLayout;
    actions->addStretch(1);
    actions->addWidget(close);

    auto* lay = new QVBoxLayout(this);
    lay->setSpacing(8);
    lay->addWidget(m_heading);
    lay->addWidget(m_table, 1);
    lay->addWidget(m_note);
    lay->addLayout(actions);

    applyTheme();
    connect(Theme::notifier(), &Theme::Notifier::changed, this, &SymbolSpecDialog::applyTheme);
    renderQuote();
}

void SymbolSpecDialog::addSection(const QString& caption) {
    const int r = m_table->rowCount();
    m_table->insertRow(r);
    auto* it = new QTableWidgetItem(caption.toUpper());
    QFont f = it->font();
    f.setBold(true);
    f.setPointSizeF(f.pointSizeF() - 1.0);
    it->setFont(f);
    m_table->setItem(r, 0, it);
    // Spanned so the caption reads as a band across the sheet rather than as
    // another property whose value happens to be blank.
    m_table->setSpan(r, 0, 1, 2);
}

void SymbolSpecDialog::addRow(const QString& key, const QString& caption, const QString& value) {
    const int r = m_table->rowCount();
    m_table->insertRow(r);
    m_table->setItem(r, 0, new QTableWidgetItem(caption));
    auto* v = new QTableWidgetItem(value);
    v->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
    QFont mono("Consolas");
    mono.setStyleHint(QFont::Monospace);
    v->setFont(mono);
    m_table->setItem(r, 1, v);
    m_rowOf.insert(key, r);
}

void SymbolSpecDialog::setValue(const QString& key, const QString& text) {
    const int r = m_rowOf.value(key, -1);
    if (r < 0) return;
    if (auto* it = m_table->item(r, 1)) it->setText(text);
}

void SymbolSpecDialog::updateQuote(const Quote& q) {
    if (!q.valid || q.symbol != m_spec.symbol) return;
    m_quote = q;
    renderQuote();
}

void SymbolSpecDialog::renderQuote() {
    const auto& c = Theme::p();
    const int d = m_spec.digits > 0 ? m_spec.digits : 5;
    const bool priced = m_quote.valid && (m_quote.bid > 0.0 || m_quote.ask > 0.0);

    setValue("bid", priced ? QString::number(m_quote.bid, 'f', d) : tr("—"));
    setValue("ask", priced ? QString::number(m_quote.ask, 'f', d) : tr("—"));

    // The feed usually carries the spread, but not always; ask minus bid is the
    // same number and is always available once a quote has arrived.
    double sp = m_quote.spread;
    if (!(sp > 0.0)) sp = m_quote.ask - m_quote.bid;
    // Shown in the same unit as the Market Watch's Spread column, with the raw
    // price difference beside it — the two disagreeing on screen would send a
    // trader looking for a bug that is only a choice of unit.
    setValue("spread", priced && sp >= 0.0
        ? tr("%1  (%2)").arg(QString::number(sp * std::pow(10.0, d - 1), 'f', 1),
                             QString::number(sp, 'f', d))
        : tr("—"));

    m_heading->setText(QString("<span style='color:%1;font-weight:700;font-size:14px;'>%2</span>"
                               "<span style='color:%3;font-size:12px;'>  %4</span>")
                       .arg(c.textStrong, m_spec.symbol, c.muted,
                            m_spec.displayName == m_spec.symbol ? QString() : m_spec.displayName));
}

void SymbolSpecDialog::setInstrumentSpec(const InstrumentSpec& spec) {
    // A panel is opened for one instrument, but the signal is on the shared
    // ApiClient — a reply for anything else is not ours.
    if (spec.symbol.compare(m_spec.symbol, Qt::CaseInsensitive) != 0) return;
    m_ext = spec;
    m_extArrived = true;
    renderExtended();
}

void SymbolSpecDialog::renderExtended() {
    const auto& c = Theme::p();
    if (!m_extArrived) return;

    if (!m_ext.valid) {
        // The rows this fetch would have filled stay honest rather than
        // showing a zero that reads as "no commission" or "no swap".
        for (const char* k : {"pip", "spreadCfg", "commission", "swapLong", "swapShort"})
            setValue(QString::fromLatin1(k), tr("unavailable"));
        m_note->setText(tr("Spread, commission and swap could not be loaded: %1")
                        .arg(m_ext.error));
        m_note->setStyleSheet(QString("color:%1; font-size:11px;").arg(c.down));
        return;
    }

    const int d = m_spec.digits > 0 ? m_spec.digits : 5;
    setValue("pip", m_ext.pipSize > 0.0 ? QString::number(m_ext.pipSize, 'f', d) : tr("—"));

    // The catalog's configured spread is what the platform charges on top of
    // the raw feed, and it is quoted either in pips or as a percentage.
    QString cfg;
    if (m_ext.spreadType.compare("percentage", Qt::CaseInsensitive) == 0)
        cfg = tr("%1 %").arg(QString::number(m_ext.spreadValue, 'f', 4));
    else if (!m_ext.spreadType.isEmpty())
        cfg = tr("%1 %2").arg(QString::number(m_ext.spreadValue, 'f', 2), m_ext.spreadType);
    else
        cfg = QString::number(m_ext.spreadValue, 'f', 2);
    setValue("spreadCfg", cfg);

    setValue("commission", m_ext.commissionPerLot > 0.0
        ? tr("%1 per lot").arg(QLocale::system().toString(m_ext.commissionPerLot, 'f', 2))
        : tr("None"));

    // Swap-free wins over the rates: on such an instrument the configured
    // numbers are never applied, and printing them would say the opposite of
    // what the account is actually charged.
    if (m_ext.swapFree) {
        setValue("swapLong",  tr("Swap-free"));
        setValue("swapShort", tr("Swap-free"));
    } else if (!m_ext.hasSwaps) {
        // Not configured is not the same as zero — see InstrumentSpec::hasSwaps.
        setValue("swapLong",  tr("Not set"));
        setValue("swapShort", tr("Not set"));
    } else {
        setValue("swapLong",  QString::number(m_ext.swapLong,  'f', 2));
        setValue("swapShort", QString::number(m_ext.swapShort, 'f', 2));
    }

    // The catalog's own volume limits override the algo list's: an admin can
    // narrow them per instrument, and that narrower pair is what an order is
    // actually checked against.
    if (m_ext.minLot > 0.0) setValue("minLot", lots(m_ext.minLot, m_spec.lotStep));
    if (m_ext.maxLot > 0.0) setValue("maxLot", lots(m_ext.maxLot, m_spec.lotStep));
    if (m_ext.contractSize > 0.0) setValue("contract", grouped(m_ext.contractSize));

    m_note->setText(tr("Commission and spread are the standard rates. Your account tier "
                       "may reduce them at order time."));
    m_note->setStyleSheet(QString("color:%1; font-size:11px;").arg(c.muted));
}

void SymbolSpecDialog::applyTheme() {
    const auto& c = Theme::p();
    setStyleSheet(QString("QDialog{background:%1;}").arg(c.panel));
    m_table->setStyleSheet(QString(
        "QTableWidget{background:%1; border:1px solid %2; border-radius:6px;"
        "gridline-color:%2; color:%3; font-size:12px;}"
        "QTableWidget::item{padding:2px 8px;}")
        .arg(c.tableBg, c.border, c.text));

    // Captions dim, values strong: the sheet is scanned down the right-hand
    // column, and a caption competing with its value slows that down.
    for (int r = 0; r < m_table->rowCount(); ++r) {
        auto* k = m_table->item(r, 0);
        auto* v = m_table->item(r, 1);
        if (!v) {   // a section band — spanned, so it has no value cell
            if (k) k->setForeground(QColor(c.accent));
            continue;
        }
        if (k) k->setForeground(QColor(c.muted));
        v->setForeground(QColor(c.textStrong));
    }
    renderQuote();
    renderExtended();
}
