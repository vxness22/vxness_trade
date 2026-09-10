#include "ui/WatchlistWidget.h"
#include "ui/Theme.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QTableWidget>
#include <QHeaderView>
#include <QMenu>
#include <QMap>
#include <QPoint>
#include <QTimer>
#include <QTime>
#include <QDateTime>
#include <QFont>
#include <QColor>
#include <QKeySequence>
#include <QPixmap>
#include <QIcon>
#include <QHash>
#include <QStyledItemDelegate>
#include <QPainter>
#include <QPen>
#include <QVariant>
#include <cmath>

// MT5 marks direction with a small arrow beside the symbol.
static const char* ARROW_UP   = "\xE2\x96\xB2";   // ▲
static const char* ARROW_DOWN = "\xE2\x96\xBC";   // ▼
static const char* ARROW_FLAT = "\xE2\x97\x8B";   // ○
static const char* STAR       = "\xE2\x98\x85";   // ★

// Where a row's tint is parked on each of its cells.
static const int kTintRole = Qt::UserRole + 41;

namespace {
// The panel's stylesheet styles QTableWidget::item, and once a stylesheet owns
// an item's background Qt paints from the sheet and ignores the brush set on
// the item itself - so setBackground() alone drew nothing and a coloured row
// came back plain. Filling here, underneath the default painting, is the one
// place a per-row colour survives that.
class RowTintDelegate : public QStyledItemDelegate {
public:
    using QStyledItemDelegate::QStyledItemDelegate;
    void paint(QPainter* p, const QStyleOptionViewItem& o,
               const QModelIndex& i) const override {
        // Selection outranks the tag, exactly as it does in MetaTrader: the
        // trader has to be able to see which row they are on.
        if (!(o.state & QStyle::State_Selected)) {
            const QColor tint = i.data(kTintRole).value<QColor>();
            if (tint.isValid()) p->fillRect(o.rect, tint);
        }
        QStyledItemDelegate::paint(p, o, i);
    }
};
}  // namespace

QString WatchlistWidget::marketGroup(const QString& category) {
    const QString c = category.toLower();
    if (c.startsWith("forex"))                              return "Forex";
    if (c.contains("crypto"))                               return "Crypto";
    if (c.contains("commodit") || c.contains("metal"))      return "Commodities";
    if (c.contains("index") || c.contains("indices"))       return "Indices";
    if (c.contains("stock") || c.contains("equity") || c.contains("share")) return "Stocks";
    return "Other";
}

WatchlistWidget::WatchlistWidget(QWidget* parent) : QWidget(parent) {
    // "Market Watch: 16:22:00" — the clock is part of MT5's panel title and is
    // the quickest confirmation that the terminal is still ticking.
    m_title = new QLabel;
    m_clock = new QTimer(this);
    m_clock->setInterval(1000);
    connect(m_clock, &QTimer::timeout, this, [this]() {
        m_title->setText(tr("Market Watch: %1").arg(QTime::currentTime().toString("HH:mm:ss")));
    });
    m_clock->start();
    m_title->setText(tr("Market Watch: %1").arg(QTime::currentTime().toString("HH:mm:ss")));

    m_search = new QLineEdit;
    m_search->setPlaceholderText(tr("Search…"));
    m_search->setClearButtonEnabled(true);
    connect(m_search, &QLineEdit::textChanged, this, [this]() { applyFilter(); });

    m_marketBtn = new QPushButton(tr("All  ▾"));
    m_marketBtn->setCursor(Qt::PointingHandCursor);
    connect(m_marketBtn, &QPushButton::clicked, this, &WatchlistWidget::openMarketMenu);

    auto* controls = new QHBoxLayout;
    controls->setContentsMargins(4, 3, 4, 3);
    controls->setSpacing(4);
    controls->addWidget(m_search, 1);
    controls->addWidget(m_marketBtn);

    m_table = new QTableWidget;
    m_table->setFont(Theme::tableFont());
    // MT5's column set. High / Low are the day's range and Time is the last
    // tick — a quote with no time on it gives a trader no way to tell a live
    // price from one frozen since the market closed.
    m_table->setColumnCount(7);
    m_table->setHorizontalHeaderLabels({tr("Symbol"), tr("Bid"), tr("Ask"), tr("Spread"),
                                        tr("High"), tr("Low"), tr("Time")});
    m_table->verticalHeader()->setVisible(false);
    m_table->verticalHeader()->setDefaultSectionSize(20);   // MT5-tight rows
    m_table->setEditTriggers(QAbstractItemView::NoEditTriggers);
    m_table->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_table->setSelectionMode(QAbstractItemView::SingleSelection);
    m_table->setShowGrid(true);
    m_table->setAlternatingRowColors(true);
    m_table->setWordWrap(false);
    // The vertical bar stays off — the list is driven by the wheel and the
    // keyboard. The horizontal one appears when it is needed, which is the
    // whole point of the column set: the panel is sized for Symbol, Bid and
    // Ask, and Spread, High, Low and Time are scrolled to rather than dropped.
    m_table->setHorizontalScrollBarPolicy(Qt::ScrollBarAsNeeded);
    m_table->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    // Per-pixel, so a sideways scroll can stop between columns instead of
    // jumping a whole one at a time.
    m_table->setHorizontalScrollMode(QAbstractItemView::ScrollPerPixel);
    // Plain interactive widths that add up to the default panel width, with
    // Spread taking the slack — and the user free to drag any of them.
    // Automatic modes were tried and both failed: Stretch-on-all elided symbols
    // to "EUR…", and Stretch-on-symbol + Fixed left the fixed widths unapplied
    // and collapsed the symbol column to "…".
    // Not stretched: the last column keeping its own width is what lets the
    // row overflow the panel and become scrollable. Stretching it instead
    // would squeeze every column back into the visible width.
    m_table->horizontalHeader()->setStretchLastSection(false);
    m_table->horizontalHeader()->setSectionResizeMode(QHeaderView::Interactive);
    m_table->setColumnWidth(0, 104);
    m_table->setColumnWidth(1, 84);
    m_table->setColumnWidth(2, 84);
    m_table->setColumnWidth(3, 56);
    m_table->setColumnWidth(4, 80);
    m_table->setColumnWidth(5, 80);
    // Time is last, so stretchLastSection owns its width.

    // Every column is present; the panel is simply narrower than the row. The
    // first three are what a trader watches all day, and the rest are one
    // sideways scroll away with their headers intact.
    applyColumns();
    m_table->setItemDelegate(new RowTintDelegate(m_table));
    connect(m_table, &QTableWidget::itemSelectionChanged,
            this, &WatchlistWidget::onSelectionChanged);
    // Row index maps straight into m_all — applyFilter() rebuilds the table in
    // that order, so the two stay aligned.
    connect(m_table, &QTableWidget::cellDoubleClicked, this, [this](int row, int) {
        const QString sym = symbolAt(row);
        if (!sym.isEmpty()) emit symbolDoubleClicked(sym);
    });
    // MT5 puts Specification / New order on the row's right-click menu, and it
    // is the first place a trader coming from there looks for them.
    m_table->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(m_table, &QTableWidget::customContextMenuRequested,
            this, &WatchlistWidget::openRowMenu);

    auto* lay = new QVBoxLayout(this);
    lay->setContentsMargins(0, 0, 0, 0);
    lay->setSpacing(0);
    lay->addWidget(m_title);
    lay->addLayout(controls);
    lay->addWidget(m_table, 1);

    applyTheme();
    connect(Theme::notifier(), &Theme::Notifier::changed, this, &WatchlistWidget::applyTheme);
}

void WatchlistWidget::applyTheme() {
    const auto& c = Theme::p();
    m_table->setFont(Theme::tableFont());   // View > Font arrives here too
    for (auto it = m_rows.constBegin(); it != m_rows.constEnd(); ++it)
        paintRowColour(it.key());           // tints are per theme; see tintFor()
    m_title->setStyleSheet(QString("background:%1; color:%2; font-weight:600; font-size:11px;"
                                   "padding:4px 6px; border-bottom:1px solid %3;")
                           .arg(c.panelAlt, c.text, c.border));
    m_search->setStyleSheet(QString(
        "QLineEdit{background:%1; border:1px solid %2; border-radius:3px;"
        "padding:3px 6px; color:%3;}"
        "QLineEdit:focus{border:1px solid %4;}")
        .arg(c.inputBg, c.inputBorder, c.textStrong, c.accent));
    m_marketBtn->setStyleSheet(QString(
        "QPushButton{background:%1; color:%2; border:1px solid %3;"
        "border-radius:3px; padding:3px 8px; font-weight:600;}"
        "QPushButton:hover{background:%4; color:%5;}")
        .arg(c.btnBg, c.text, c.btnBorder, c.btnHover, c.textStrong));

    // Row colours live in the items, so replay the last tick for each row.
    for (auto it = m_rows.begin(); it != m_rows.end(); ++it) {
        const Row& r = it.value();
        if (r.row < 0) continue;
        if (auto* bid = m_table->item(r.row, 1))
            bid->setForeground(QColor(r.dir > 0 ? c.up : r.dir < 0 ? c.down : c.text));
        if (auto* ask = m_table->item(r.row, 2))
            ask->setForeground(QColor(r.dir > 0 ? c.up : r.dir < 0 ? c.down : c.text));
        if (auto* sym = m_table->item(r.row, 0))
            sym->setForeground(QColor(r.dir > 0 ? c.up : r.dir < 0 ? c.down : c.muted));
    }
}

void WatchlistWidget::setSymbols(const QVector<SymbolSpec>& symbols) {
    m_all = symbols;
    m_rows.clear();
    m_selected.clear();

    const auto& c = Theme::p();

    m_selecting = true;
    m_table->setRowCount(symbols.size());
    int r = 0;
    for (const SymbolSpec& s : symbols) {
        auto* sym = new QTableWidgetItem(symbolLabel(s.symbol, ARROW_FLAT));
        sym->setForeground(QColor(c.muted));

        for (int col = 1; col < m_table->columnCount(); ++col) {
            auto* it = new QTableWidgetItem("—");
            // No per-cell font: the whole table carries one face now, set in
            // the constructor. Right alignment is what keeps the decimal
            // points in a column, which is the only thing the old monospace
            // was really buying.
            it->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
            m_table->setItem(r, col, it);
        }
        m_table->setItem(r, 0, sym);

        Row row;
        row.row = r; row.digits = s.digits; row.group = marketGroup(s.category);
        m_rows.insert(s.symbol, row);
        ++r;
    }
    m_selecting = false;

    applyFilter();
    // Every cell above is brand new, so any row colour painted earlier died
    // with the items it was painted on. Restore from the tags, which outlive
    // the table: the colours are read from Config before the broker has even
    // answered with a symbol list, so this is where they first become visible.
    for (auto it = m_colours.constBegin(); it != m_colours.constEnd(); ++it)
        paintRowColour(it.key());
    if (!symbols.isEmpty()) selectSymbol(symbols.front().symbol);
}

int WatchlistWidget::columnForKey(const QString& key) {
    if (key == "spread") return 3;
    if (key == "high")   return 4;
    if (key == "low")    return 5;
    if (key == "time")   return 6;
    return -1;
}

QString WatchlistWidget::symbolLabel(const QString& symbol, const char* arrow) const {
    const QString base = QStringLiteral("%1  %2").arg(QString::fromUtf8(arrow), symbol);
    return m_favourites.contains(symbol)
        ? QStringLiteral("%1 %2").arg(QString::fromUtf8(STAR), base)
        : base;
}

void WatchlistWidget::setFavourites(const QStringList& symbols) {
    m_favourites = symbols;
    // Repaint the stars now rather than on the next tick: an instrument whose
    // market is closed would otherwise stay unstarred until it moved again.
    for (auto it = m_rows.constBegin(); it != m_rows.constEnd(); ++it) {
        if (it->row < 0) continue;
        if (auto* cell = m_table->item(it->row, 0))
            cell->setText(symbolLabel(it.key(),
                it->dir > 0 ? ARROW_UP : it->dir < 0 ? ARROW_DOWN : ARROW_FLAT));
    }
    applyFilter();
}

void WatchlistWidget::toggleFavourite(const QString& symbol) {
    if (m_favourites.contains(symbol)) m_favourites.removeAll(symbol);
    else                               m_favourites << symbol;
    setFavourites(m_favourites);
    emit favouritesChanged(m_favourites);
}

// ── hiding, colouring and the rest of the Market Watch's own menu ──────────

void WatchlistWidget::setHiddenSymbols(const QStringList& symbols) {
    m_hiddenSymbols = symbols;
    applyFilter();
}

void WatchlistWidget::hideSymbol(const QString& symbol) {
    if (symbol.isEmpty() || m_hiddenSymbols.contains(symbol)) return;
    m_hiddenSymbols << symbol;
    applyFilter();
    emit hiddenSymbolsChanged(m_hiddenSymbols);
}

// Everything except the row the menu was opened on, which is what MT5's
// "Hide All" does — it leaves you the one you are looking at rather than an
// empty panel with no way back except Show All.
void WatchlistWidget::hideAllSymbols() {
    m_hiddenSymbols.clear();
    for (const SymbolSpec& s : m_all)
        if (s.symbol != m_selected) m_hiddenSymbols << s.symbol;
    applyFilter();
    emit hiddenSymbolsChanged(m_hiddenSymbols);
}

void WatchlistWidget::showAllSymbols() {
    if (m_hiddenSymbols.isEmpty()) return;
    m_hiddenSymbols.clear();
    applyFilter();
    emit hiddenSymbolsChanged(m_hiddenSymbols);
}

void WatchlistWidget::setGridVisible(bool on) {
    m_grid = on;
    m_table->setShowGrid(on);
}

// Sizes every column to its widest cell. Interactive mode is restored straight
// after, so the trader can still drag a column afterwards — MT5's Auto Arrange
// is a one-shot tidy, not a mode you get stuck in.
void WatchlistWidget::autoArrangeColumns() {
    m_table->resizeColumnsToContents();
    m_table->horizontalHeader()->setSectionResizeMode(QHeaderView::Interactive);
}

// ── row colours ────────────────────────────────────────────────────────────

QColor WatchlistWidget::tintFor(const QString& colourName) {
    if (colourName.isEmpty() || colourName == QLatin1String("none")) return QColor();
    // Tinted per theme rather than stored as hex: the same tag has to stay
    // readable on a white table and on a near-black one, and a trader who
    // picked "amber" means the tag, not a particular RGB value.
    const bool dark = Theme::isDark();
    static const QHash<QString, QPair<QString, QString>> kTints = {
        //  name              light             dark
        {QStringLiteral("amber"),  {QStringLiteral("#fff3c4"), QStringLiteral("#4a3c12")}},
        {QStringLiteral("green"),  {QStringLiteral("#d8f3dc"), QStringLiteral("#12371f")}},
        {QStringLiteral("blue"),   {QStringLiteral("#dbeafe"), QStringLiteral("#13294a")}},
        {QStringLiteral("red"),    {QStringLiteral("#fde2e1"), QStringLiteral("#4a1a1a")}},
        {QStringLiteral("purple"), {QStringLiteral("#ede4fb"), QStringLiteral("#33224d")}},
        {QStringLiteral("cyan"),   {QStringLiteral("#d7f2f6"), QStringLiteral("#0f3b42")}},
    };
    const auto it = kTints.constFind(colourName);
    if (it == kTints.constEnd()) return QColor();
    return QColor(dark ? it->second : it->first);
}

void WatchlistWidget::paintRowColour(const QString& symbol) {
    const auto it = m_rows.constFind(symbol);
    if (it == m_rows.constEnd() || it->row < 0) return;
    const QColor tint = tintFor(m_colours.value(symbol));
    for (int col = 0; col < m_table->columnCount(); ++col) {
        if (auto* cell = m_table->item(it->row, col)) {
            // An invalid brush hands the row back to the table's own
            // alternating background, which is what "no colour" has to mean.
            cell->setBackground(tint.isValid() ? QBrush(tint) : QBrush());
            cell->setData(kTintRole, tint.isValid() ? QVariant(tint) : QVariant());
        }
    }
}

void WatchlistWidget::setSymbolColour(const QString& symbol, const QString& colourName) {
    if (colourName.isEmpty() || colourName == QLatin1String("none"))
        m_colours.remove(symbol);
    else
        m_colours.insert(symbol, colourName);
    paintRowColour(symbol);
    emit symbolColoursChanged(symbolColours());
}

QStringList WatchlistWidget::symbolColours() const {
    QStringList out;
    for (auto it = m_colours.constBegin(); it != m_colours.constEnd(); ++it)
        out << it.key() + QLatin1Char('=') + it.value();
    out.sort();                      // stable on disk, so the file stops churning
    return out;
}

void WatchlistWidget::setSymbolColours(const QStringList& pairs) {
    m_colours.clear();
    for (const QString& p : pairs) {
        const int eq = p.indexOf(QLatin1Char('='));
        if (eq <= 0) continue;
        m_colours.insert(p.left(eq), p.mid(eq + 1));
    }
    for (auto it = m_rows.constBegin(); it != m_rows.constEnd(); ++it)
        paintRowColour(it.key());
}

void WatchlistWidget::applyColumns() {
    for (const char* key : {"spread", "high", "low", "time"}) {
        const int col = columnForKey(QString::fromLatin1(key));
        if (col >= 0) m_table->setColumnHidden(col, m_hidden.contains(QString::fromLatin1(key)));
    }
}

int WatchlistWidget::preferredWidth() const {
    int w = 0;
    for (int c = 0; c < m_table->columnCount(); ++c)
        if (!m_table->isColumnHidden(c)) w += m_table->columnWidth(c);
    // The table's own border on both sides, plus a pixel so the last column's
    // gridline is not the thing that gets clipped.
    w += m_table->frameWidth() * 2 + 2;
    // Never below what the search row needs — a panel sized for the Symbol
    // column alone would cut the market filter button in half.
    return qMax(w, minimumWidth());
}

void WatchlistWidget::setHiddenColumns(const QStringList& keys) {
    m_hidden = keys;
    applyColumns();
}

QString WatchlistWidget::symbolAt(int row) const {
    if (row < 0 || row >= m_all.size()) return {};
    return m_all.at(row).symbol;
}

void WatchlistWidget::openRowMenu(const QPoint& pos) {
    const QString sym = symbolAt(m_table->rowAt(pos.y()));
    if (sym.isEmpty()) return;
    // Select first: the menu names this instrument, so the highlight has to
    // agree with it before anything is chosen.
    selectSymbol(sym);

    const auto& c = Theme::p();
    QMenu menu(this);
    menu.setStyleSheet(QString(
        "QMenu{background:%1; border:1px solid %2; padding:3px;}"
        "QMenu::item{padding:5px 22px 5px 12px; color:%3;}"
        "QMenu::item:selected{background:%4; color:%5;}"
        "QMenu::separator{height:1px; background:%2; margin:3px 0;}")
        .arg(c.menuBg, c.menuBorder, c.text, c.menuSel, c.textStrong));

    // Laid out the way MetaTrader lays this menu out, because that is the order
    // a trader's hand already knows. Entries with nothing behind them on this
    // platform — Tick Chart, Depth of Market, Sets, Popup Prices — are left out
    // rather than added as items that open nothing.

    // ── act on this instrument ──
    QAction* order = menu.addAction(tr("New Order"));
    order->setShortcut(QKeySequence(Qt::Key_F9));
    connect(order, &QAction::triggered, this, [this, sym]() { emit symbolDoubleClicked(sym); });

    connect(menu.addAction(tr("Chart Window")), &QAction::triggered,
            this, [this, sym]() { emit symbolActivated(sym); });

    connect(menu.addAction(tr("Specification…")), &QAction::triggered,
            this, [this, sym]() { emit specificationRequested(sym); });
    menu.addSeparator();

    // ── what the list shows ──
    const bool starred = m_favourites.contains(sym);
    connect(menu.addAction(starred ? tr("Remove from Favourites")
                                   : tr("Add to Favourites")),
            &QAction::triggered, this, [this, sym]() { toggleFavourite(sym); });

    QAction* hide = menu.addAction(tr("Hide"));
    hide->setShortcut(QKeySequence(Qt::Key_Delete));
    connect(hide, &QAction::triggered, this, [this, sym]() { hideSymbol(sym); });

    connect(menu.addAction(tr("Hide All")), &QAction::triggered,
            this, [this]() { hideAllSymbols(); });
    QAction* showAll = menu.addAction(tr("Show All"));
    showAll->setEnabled(!m_hiddenSymbols.isEmpty());
    connect(showAll, &QAction::triggered, this, [this]() { showAllSymbols(); });
    menu.addSeparator();

    // ── colour this row ──
    QMenu* colours = menu.addMenu(tr("Colour"));
    colours->setStyleSheet(menu.styleSheet());
    struct { const char* key; const char* label; } kColours[] = {
        {"none",   QT_TR_NOOP("None")},
        {"amber",  QT_TR_NOOP("Amber")},
        {"green",  QT_TR_NOOP("Green")},
        {"blue",   QT_TR_NOOP("Blue")},
        {"red",    QT_TR_NOOP("Red")},
        {"purple", QT_TR_NOOP("Purple")},
        {"cyan",   QT_TR_NOOP("Cyan")},
    };
    const QString current = m_colours.value(sym);
    for (const auto& col : kColours) {
        QAction* a = colours->addAction(tr(col.label));
        a->setCheckable(true);
        const QString key = QString::fromLatin1(col.key);
        a->setChecked(key == QLatin1String("none") ? current.isEmpty() : current == key);
        // A swatch beside the name, so the menu shows the colours rather than
        // just naming them.
        //
        // The tick is drawn INTO the swatch. Qt gives a menu entry one slot at
        // the left and puts the icon there when an action has both, so a
        // checkable entry carrying a swatch showed the swatch and swallowed
        // the check — leaving no way to see which colour a row already had.
        const QColor tint = tintFor(key);
        if (tint.isValid()) {
            QPixmap pm(14, 14);
            pm.fill(Qt::transparent);
            QPainter p(&pm);
            p.setRenderHint(QPainter::Antialiasing, true);
            p.fillRect(pm.rect(), tint);
            p.setPen(QPen(QColor(c.border), 1));
            p.drawRect(0, 0, 13, 13);
            if (a->isChecked()) {
                p.setPen(QPen(QColor(c.textStrong), 2));
                p.drawLine(3, 7, 6, 10);
                p.drawLine(6, 10, 11, 4);
            }
            p.end();
            a->setIcon(QIcon(pm));
        }
        connect(a, &QAction::triggered, this, [this, sym, key]() {
            setSymbolColour(sym, key);
        });
    }
    menu.addSeparator();

    // ── columns, flat and checkable, the way MT5 has them ──
    //
    // High and Low are ONE entry there, and a trader who wants the day's range
    // wants both halves of it, so they are toggled together here too.
    struct { const char* keys; const char* label; } kCols[] = {
        {"spread",   QT_TR_NOOP("Spread")},
        {"high,low", QT_TR_NOOP("High/Low")},
        {"time",     QT_TR_NOOP("Time")},
    };
    for (const auto& oc : kCols) {
        QAction* a = menu.addAction(tr(oc.label));
        a->setCheckable(true);
        const QStringList keys = QString::fromLatin1(oc.keys).split(QLatin1Char(','));
        a->setChecked(!m_hidden.contains(keys.first()));
        connect(a, &QAction::triggered, this, [this, keys](bool on) {
            for (const QString& k : keys) {
                if (on) m_hidden.removeAll(k);
                else if (!m_hidden.contains(k)) m_hidden << k;
            }
            applyColumns();
            emit columnsChanged(m_hidden);
        });
    }

    QAction* grid = menu.addAction(tr("Grid"));
    grid->setCheckable(true);
    grid->setChecked(m_grid);
    connect(grid, &QAction::triggered, this, [this](bool on) {
        setGridVisible(on);
        emit gridChanged(on);
    });

    connect(menu.addAction(tr("Auto Arrange")), &QAction::triggered,
            this, [this]() { autoArrangeColumns(); });

    menu.exec(m_table->viewport()->mapToGlobal(pos));
}

void WatchlistWidget::onSelectionChanged() {
    if (m_selecting) return;
    const int r = m_table->currentRow();
    if (r < 0 || r >= m_all.size()) return;
    const QString sym = m_all.at(r).symbol;
    if (sym == m_selected) return;
    m_selected = sym;
    emit symbolActivated(sym);
}

void WatchlistWidget::selectSymbol(const QString& symbol) {
    auto it = m_rows.constFind(symbol);
    if (it == m_rows.constEnd() || it->row < 0) return;
    if (symbol == m_selected) return;
    m_selected = symbol;
    m_selecting = true;
    m_table->selectRow(it->row);
    m_selecting = false;
    emit symbolActivated(symbol);
}

void WatchlistWidget::openMarketMenu() {
    QMap<QString, int> counts;
    for (const SymbolSpec& s : m_all) counts[marketGroup(s.category)]++;

    const auto& c = Theme::p();
    QMenu menu(this);
    menu.setStyleSheet(QString(
        "QMenu{background:%1; border:1px solid %2; padding:3px;}"
        "QMenu::item{padding:5px 18px 5px 12px; color:%3;}"
        "QMenu::item:selected{background:%4; color:%5;}")
        .arg(c.menuBg, c.menuBorder, c.text, c.menuSel, c.textStrong));

    QAction* all = menu.addAction(tr("All Markets   (%1)").arg(m_all.size()));
    connect(all, &QAction::triggered, this, [this]() { setMarket(QString()); });

    // Favourites is a filter like any market group, so it belongs on the same
    // menu rather than in a control of its own. Listed even when empty, or the
    // way to use the feature would be invisible until it was already in use.
    QAction* fav = menu.addAction(tr("%1 Favourites   (%2)")
                                      .arg(QString::fromUtf8(STAR))
                                      .arg(m_favourites.size()));
    connect(fav, &QAction::triggered, this, [this]() {
        m_favOnly = true;
        m_activeGroup.clear();
        m_marketBtn->setText(QString::fromUtf8(STAR) + tr("  ▾"));
        applyFilter();
    });
    menu.addSeparator();

    const QStringList order = {"Forex", "Crypto", "Commodities", "Indices", "Stocks", "Other"};
    for (const QString& g : order) {
        if (!counts.contains(g)) continue;
        QAction* a = menu.addAction(QString("%1   (%2)").arg(g).arg(counts[g]));
        connect(a, &QAction::triggered, this, [this, g]() { setMarket(g); });
    }
    menu.exec(m_marketBtn->mapToGlobal(QPoint(0, m_marketBtn->height() + 2)));
}

void WatchlistWidget::setMarket(const QString& group) {
    m_favOnly = false;            // choosing a market is leaving favourites
    m_activeGroup = group;
    m_marketBtn->setText((group.isEmpty() ? tr("All") : group) + "  ▾");
    applyFilter();
}

void WatchlistWidget::applyFilter() {
    const QString q = m_search->text().trimmed().toUpper();
    for (const SymbolSpec& s : m_all) {
        auto it = m_rows.constFind(s.symbol);
        if (it == m_rows.constEnd() || it->row < 0) continue;
        // Hidden by the trader from the row menu — MT5's Hide. Checked first
        // because it outranks every other filter: a hidden instrument stays
        // hidden whichever market group or search is active.
        if (m_hiddenSymbols.contains(s.symbol)) { m_table->setRowHidden(it->row, true); continue; }
        const bool groupOk  = m_favOnly ? m_favourites.contains(s.symbol)
                                        : (m_activeGroup.isEmpty() || it->group == m_activeGroup);
        const bool searchOk = q.isEmpty()
            || s.symbol.toUpper().contains(q)
            || s.displayName.toUpper().contains(q);
        // Instruments the feed never quotes would sit here as a column of "—"
        // forever. Hide until a price arrives; updateQuote() reveals the row on
        // the first quote, so nothing tradable stays hidden.
        m_table->setRowHidden(it->row, !(groupOk && searchOk && it->hasPrice));
    }
}

void WatchlistWidget::setDailyRange(const QString& symbol, double high, double low) {
    auto it = m_rows.find(symbol);
    if (it == m_rows.end() || it->row < 0) return;
    Row& row = it.value();
    if (!(high > 0.0) || !(low > 0.0)) return;

    // Merge rather than overwrite. Ticks taken since the terminal opened can
    // already sit outside the bar the server aggregated, and a re-seed that
    // narrowed the range back would show a high the price has visibly passed.
    row.high = row.hasRange ? qMax(row.high, high) : high;
    row.low  = row.hasRange ? qMin(row.low,  low)  : low;
    row.hasRange = true;
    if (auto* h = m_table->item(row.row, 4)) h->setText(QString::number(row.high, 'f', row.digits));
    if (auto* l = m_table->item(row.row, 5)) l->setText(QString::number(row.low,  'f', row.digits));
}

void WatchlistWidget::updateQuote(const Quote& q) {
    auto it = m_rows.find(q.symbol);
    if (it == m_rows.end() || it->row < 0) return;
    Row& row = it.value();
    const auto& t = Theme::p();

    // First real quote for this symbol — it earns its place in the list.
    if (!row.hasPrice && (q.bid > 0.0 || q.ask > 0.0)) {
        row.hasPrice = true;
        applyFilter();
    }

    if (q.bid > row.lastBid)      row.dir = 1;
    else if (q.bid < row.lastBid) row.dir = -1;
    row.lastBid = q.bid;

    const QColor dirColor(row.dir > 0 ? t.up : row.dir < 0 ? t.down : t.text);

    if (auto* sym = m_table->item(row.row, 0)) {
        const char* arrow = row.dir > 0 ? ARROW_UP : row.dir < 0 ? ARROW_DOWN : ARROW_FLAT;
        sym->setText(symbolLabel(q.symbol, arrow));
        sym->setForeground(dirColor);
    }
    if (auto* bid = m_table->item(row.row, 1)) {
        bid->setText(QString::number(q.bid, 'f', row.digits));
        bid->setForeground(dirColor);
    }
    if (auto* ask = m_table->item(row.row, 2)) {
        ask->setText(QString::number(q.ask, 'f', row.digits));
        ask->setForeground(dirColor);
    }
    // Spread in points, the unit MT5 shows it in.
    if (auto* sp = m_table->item(row.row, 3)) {
        const double points = q.spread * std::pow(10.0, row.digits - 1);
        sp->setText(QString::number(points, 'f', 1));
    }

    // Day's range, tracked at BID so it agrees with the Bid column beside it.
    if (q.bid > 0.0) {
        if (!row.hasRange) { row.high = row.low = q.bid; row.hasRange = true; }
        else { row.high = qMax(row.high, q.bid); row.low = qMin(row.low, q.bid); }
        if (auto* h = m_table->item(row.row, 4))
            h->setText(QString::number(row.high, 'f', row.digits));
        if (auto* l = m_table->item(row.row, 5))
            l->setText(QString::number(row.low,  'f', row.digits));
    }

    // Tick time, in the same local clock as the panel's own header — a feed
    // timestamp shown in UTC next to a local-time title reads as a stopped
    // clock for anyone not on UTC. An unparseable timestamp falls back to
    // arrival time rather than blanking a column that says "is this live?".
    if (auto* tm = m_table->item(row.row, 6)) {
        const QDateTime stamp = q.timestamp.isValid() ? q.timestamp.toLocalTime()
                                                      : QDateTime::currentDateTime();
        tm->setText(stamp.time().toString("HH:mm:ss"));
    }
}
