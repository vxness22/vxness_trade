#include "ui/ChartArea.h"
#include "ui/WebChartWidget.h"
#include "ui/Theme.h"
#include <QGridLayout>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFrame>
#include <QLabel>
#include <QToolButton>
#include <QApplication>
#include <QMouseEvent>

ChartArea::ChartArea(ApiClient* api, PriceStream* stream, QWidget* parent)
    : QWidget(parent), m_api(api), m_stream(stream) {
    // The tiled charts and the strip of minimized title bars are stacked, so
    // a minimized pane gives its space to the charts still tiled rather than
    // leaving a gap in the grid where it used to be.
    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(0, 0, 0, 0);
    root->setSpacing(2);

    m_gridHost = new QWidget(this);
    m_grid = new QGridLayout(m_gridHost);
    m_grid->setContentsMargins(0, 0, 0, 0);
    m_grid->setSpacing(2);

    m_minStrip = new QWidget(this);
    m_minLay = new QHBoxLayout(m_minStrip);
    m_minLay->setContentsMargins(0, 0, 0, 0);
    m_minLay->setSpacing(2);
    m_minLay->addStretch(1);
    m_minStrip->hide();

    buildTabBar();

    root->addWidget(m_gridHost, 1);
    root->addWidget(m_minStrip, 0);
    // Along the bottom, where MetaTrader puts them and where the desk's
    // screenshot shows them.
    root->addWidget(m_tabHost, 0);

    m_panes.resize(4);
    ensurePane(0);
    relayout();

    connect(qApp, &QApplication::focusChanged, this,
            [this](QWidget*, QWidget* now) { onFocusChanged(now); });
    connect(Theme::notifier(), &Theme::Notifier::changed, this, &ChartArea::applyTheme);
}

ChartArea::Pane& ChartArea::ensurePane(int index) {
    Pane& p = m_panes[index];
    if (p.chart) return p;

    p.frame = new QFrame(m_gridHost);
    // Named so paintPaneStates() can target THIS frame and nothing else. A bare
    // `QFrame{...}` selector also matches every QFrame-derived descendant — and
    // QLabel derives from QFrame — so the active pane's accent border was being
    // painted around every label inside it, including the one-click strip's
    // price tiles and spread readout. That looked like a blue box drawn on the
    // BUY/SELL buttons. See the selector in paintPaneStates().
    p.frame->setObjectName(QStringLiteral("chartPane"));
    auto* v = new QVBoxLayout(p.frame);
    v->setContentsMargins(1, 1, 1, 1);
    v->setSpacing(0);

    // A one-line header per pane: it names the chart, marks which one the
    // watchlist will drive, carries the ✕, and gives a click target that is not
    // the web view (which never forwards clicks to the host).
    p.header = new QWidget(p.frame);
    p.header->setFixedHeight(18);
    auto* h = new QHBoxLayout(p.header);
    h->setContentsMargins(6, 0, 2, 0);
    h->setSpacing(4);

    p.title = new QLabel(tr("Chart %1").arg(index + 1), p.header);

    // The three window controls, in the order every desktop puts them.
    auto mkBtn = [&](const QString& glyph, const QString& tip) {
        auto* b = new QToolButton(p.header);
        b->setText(glyph);
        b->setFixedSize(14, 14);
        b->setCursor(Qt::ArrowCursor);
        b->setToolTip(tip);
        b->setFocusPolicy(Qt::NoFocus);            // must not steal pane focus
        b->setAutoRaise(true);
        return b;
    };
    p.minBtn   = mkBtn(QStringLiteral("–"), tr("Minimize this chart"));   // –
    p.maxBtn   = mkBtn(QStringLiteral("□"), tr("Maximize this chart"));   // □
    p.closeBtn = mkBtn(QStringLiteral("✕"), tr("Close this chart"));      // ✕

    h->addWidget(p.title);
    h->addStretch(1);
    h->addWidget(p.minBtn);
    h->addWidget(p.maxBtn);
    h->addWidget(p.closeBtn);

    // The whole header selects the pane; the ✕ closes it. Both read their slot
    // from the paneIndex property, which refreshPaneHeaders() keeps current —
    // `index` is only correct until the first close shifts things.
    p.header->installEventFilter(this);
    p.title->installEventFilter(this);
    p.header->setProperty("paneIndex", index);
    p.title->setProperty("paneIndex", index);
    p.minBtn->setProperty("paneIndex", index);
    p.maxBtn->setProperty("paneIndex", index);
    p.closeBtn->setProperty("paneIndex", index);
    connect(p.closeBtn, &QToolButton::clicked, this, [this, btn = p.closeBtn]() {
        closePane(btn->property("paneIndex").toInt());
    });
    connect(p.minBtn, &QToolButton::clicked, this, [this, btn = p.minBtn]() {
        const int i = btn->property("paneIndex").toInt();
        // The same button restores a minimized pane, so the title bar in the
        // strip is not a dead end — it is the only way back for a pane that
        // has left the grid.
        if (i >= 0 && i < m_panes.size() && m_panes[i].minimized) restorePane(i);
        else                                                      minimizePane(i);
    });
    connect(p.maxBtn, &QToolButton::clicked, this, [this, btn = p.maxBtn]() {
        toggleMaximizePane(btn->property("paneIndex").toInt());
    });

    p.chart = new WebChartWidget(m_api, m_stream, p.frame);
    p.chart->setMinimumSize(220, 160);
    // Panes are built on demand, so one opened after the trader switched the
    // Data Window on has to be told about it here — setDataWindow() on the area
    // only reaches the panes that existed when it was called.
    p.chart->setDataWindow(m_dataWindow);

    // A symbol chosen inside the chart is as real a choice as one clicked in
    // the Market Watch, so record it the same way: the pane header follows it,
    // and symbols() picks it up, which is what gets saved and restored.
    // Looked up by widget rather than captured index — a ✕ shuffles the panes
    // along, and a captured index would rename whichever chart moved into the
    // closed one's slot.
    connect(p.chart, &WebChartWidget::symbolPickedInChart, this,
            [this, w = p.chart](const QString& symbol) {
        for (Pane& q : m_panes) {
            if (q.chart == w) {
                if (q.symbol == symbol) return;
                q.symbol = symbol;
                refreshPaneHeaders();
                refreshTabs();
                emit symbolPickedInChart(symbol);
                return;
            }
        }
    });

    // The timeframe toolbar highlights the ACTIVE pane's timeframe, so only
    // that pane's changes are worth relaying. Every pane is connected anyway
    // and the filter happens here: a pane can change timeframe while another
    // is active (a profile load touches all four), and letting that move the
    // highlight would point it at a chart the trader is not looking at.
    connect(p.chart, &WebChartWidget::resolutionChanged, this,
            [this, w = p.chart](const QString& res) {
        // Every pane's tab shows its own timeframe, so all of them redraw;
        // only the ACTIVE pane's change moves the toolbar highlight.
        refreshTabs();
        if (activeChart() == w) emit activeResolutionChanged(res);
    });

    v->addWidget(p.header);
    v->addWidget(p.chart, 1);

    // Panes built after startup have missed every fan-out so far; replay them.
    if (!m_symbols.isEmpty())   p.chart->setSymbols(m_symbols);
    if (!m_positions.isEmpty()) p.chart->setPositions(m_positions);
    p.chart->setTheme(Theme::name());
    // A new pane opens on whatever the active one is showing, which is almost
    // always what a trader comparing timeframes wants as a starting point.
    const QString seed = m_panes[m_active].symbol;
    if (!seed.isEmpty()) {
        p.symbol = seed;
        p.chart->showSymbol(seed);
        // Title text is not set here — refreshPaneHeaders() owns it, and it is
        // the only place that knows the pane's current slot after a close.
    }
    return p;
}

bool ChartArea::eventFilter(QObject* o, QEvent* e) {
    if (e->type() == QEvent::MouseButtonPress) {
        const QVariant idx = o->property("paneIndex");
        if (idx.isValid()) setActive(idx.toInt());
        // A chart tab. Separate from paneIndex because a tab does more than
        // select: it can also bring a minimized pane back, or change which
        // pane is the one being shown alone.
        const QVariant tab = o->property("tabIndex");
        if (tab.isValid()) showPaneFromTab(tab.toInt());
    }
    return QWidget::eventFilter(o, e);
}

void ChartArea::setChartCount(int count) {
    const int n = qBound(1, count, 4);
    if (n == m_count) return;
    m_count = n;
    // Asking for a grid is asking to see it: staying maximized would show one
    // chart and silently ignore the choice just made in the menu.
    m_maximized = -1;
    for (int i = 0; i < n; ++i) {
        ensurePane(i);
        // A pane brought back by a bigger layout must not still be parked in
        // the minimized strip from an earlier session of the same window.
        m_panes[i].minimized = false;
    }
    if (m_active >= n) setActive(0);
    relayout();
    emit chartCountChanged(m_count);
}

void ChartArea::closePane(int index) {
    // Refuse to close the last one: the chart area would be blank with no
    // affordance to get a chart back except the menu.
    if (m_count <= 1) return;
    if (index < 0 || index >= m_count) return;

    // Move rather than delete, so the pane keeps its symbol/timeframe/drawings
    // and its QWebEngineView is not torn down and rebuilt. Parking it past
    // m_count is enough to hide it — relayout() only shows the first m_count.
    Pane closed = m_panes[index];
    // A closed pane comes back through the layout menu, and it should come
    // back as a chart rather than as a title bar in the strip.
    closed.minimized = false;
    m_panes.remove(index);
    m_panes.append(closed);
    --m_count;
    // Slots shift under a close, so a stored one no longer means what it did.
    // Restoring the grid is also the only sensible answer here: while a pane
    // is maximized it is the only one on screen, so it is the one being closed.
    m_maximized = -1;

    // Keep the selection pointing at the same PANE where possible. Closing the
    // active one falls to whatever slid into its slot (or the new last pane if
    // it was the tail); closing one before it means everything after shifted
    // down by one.
    if (m_active == index)     m_active = qMin(index, m_count - 1);
    else if (m_active > index) --m_active;
    m_active = qBound(0, m_active, m_count - 1);

    relayout();
    emit activeChartChanged(m_active);
    emit chartCountChanged(m_count);
}

void ChartArea::tile(const QVector<int>& order) {
    const int n = order.size();
    for (int k = 0; k < n; ++k) {
        Pane& p = m_panes[order.at(k)];
        // 1 -> one cell across both columns
        // 2 -> side by side
        // 3 -> two on top, the third spanning the bottom row
        // 4 -> 2x2
        // The 3 case arises by closing a pane out of a 2x2, or by minimizing
        // one; spanning the odd one out beats leaving a dead quarter empty.
        int row = 0, col = 0, colSpan = 1;
        if (n == 1) {
            colSpan = 2;
        } else if (n == 2) {
            col = k;
        } else if (n == 3) {
            if (k < 2) { col = k; }
            else       { row = 1; colSpan = 2; }
        } else {
            row = k / 2;
            col = k % 2;
        }
        m_grid->addWidget(p.frame, row, col, 1, colSpan);
        p.frame->show();
    }
    const bool twoRows = (n >= 3);
    for (int r = 0; r < 2; ++r)
        m_grid->setRowStretch(r, (twoRows || r == 0) ? 1 : 0);
    for (int c = 0; c < 2; ++c)
        m_grid->setColumnStretch(c, 1);
}

void ChartArea::relayout() {
    // Detach everything first: QGridLayout keeps an item at its old cell
    // otherwise, and 4 -> 2 would leave the bottom row occupying dead space.
    for (Pane& p : m_panes) {
        if (!p.frame) continue;
        m_grid->removeWidget(p.frame);
        m_minLay->removeWidget(p.frame);
        p.frame->hide();
        // Undo a previous stint in the strip before deciding this pass.
        p.frame->setMinimumHeight(0);
        p.frame->setMaximumHeight(QWIDGETSIZE_MAX);
    }

    // Three groups: the pane shown alone (if any), the ones tiled, and the
    // ones docked in the strip as title bars.
    QVector<int> tiled;
    QVector<int> docked;
    for (int i = 0; i < m_count; ++i) {
        if (m_panes[i].minimized) docked.append(i);
        else if (m_maximized < 0 || m_maximized == i) tiled.append(i);
    }
    if (m_maximized >= 0 && m_maximized < m_count && !m_panes[m_maximized].minimized)
        tiled = {m_maximized};

    for (int i : tiled)
        if (m_panes[i].chart) m_panes[i].chart->show();
    tile(tiled);

    for (int i : docked) {
        Pane& p = m_panes[i];
        // Only the title bar is left. The chart is HIDDEN rather than merely
        // squeezed: a WebChartWidget carries a 220x160 minimum, which a frame
        // still containing one could never shrink below.
        if (p.chart) p.chart->hide();
        const int barH = (p.header ? p.header->height() : 18) + 2;   // + frame margins
        p.frame->setFixedHeight(barH > 4 ? barH : 20);
        p.frame->setMinimumWidth(170);
        // Before the stretch, so the bars pack from the left.
        m_minLay->insertWidget(m_minLay->count() - 1, p.frame);
        p.frame->show();
    }
    m_minStrip->setVisible(!docked.isEmpty());
    // Every chart minimized leaves the grid genuinely empty; it should not go
    // on claiming the height it would have used.
    m_gridHost->setVisible(!tiled.isEmpty());

    // Every chart carries the three controls, single chart included — that is
    // what a chart window looks like. Close is the one that cannot always
    // apply: closePane() refuses the last chart, so it says so by going flat.
    for (Pane& p : m_panes) {
        if (p.header) p.header->setVisible(true);
        if (p.closeBtn) p.closeBtn->setEnabled(m_count > 1);
    }

    // Split view: strip the chart's drawing toolbar and bottom date-range bar.
    // At full size they are worth their room; in a half or quarter pane they
    // eat most of it. setCompact() is a no-op when the value is unchanged, so
    // this does not rebuild charts on every relayout — only when the grid
    // actually crosses between one pane and several.
    const bool split = tiled.size() > 1;
    for (Pane& p : m_panes)
        if (p.chart) p.chart->setCompact(split);

    refreshPaneHeaders();
    paintPaneStates();
    // The tabs describe the grid, so every relayout is a reason to redraw them:
    // a pane closed, minimized, maximized or added changes what they say.
    refreshTabs();
    if (m_overlay) setOverlayWidget(m_overlay);   // re-home it on the active pane
}

void ChartArea::minimizePane(int index) {
    if (index < 0 || index >= m_count) return;
    Pane& p = m_panes[index];
    if (p.minimized) return;
    p.minimized = true;
    // A maximized pane that is then minimized has nothing left to be maximized
    // over, so the grid comes back with it.
    if (m_maximized == index) m_maximized = -1;

    // The one-click strip and the order window follow the ACTIVE pane, and a
    // pane in the strip has no chart to sit on. Hand the selection to one that
    // is still tiled; if none is, the strip has nowhere to go and the trader
    // gets it back by restoring a chart.
    if (m_active == index) {
        for (int i = 0; i < m_count; ++i) {
            if (!m_panes[i].minimized) { setActive(i); break; }
        }
    }
    relayout();
}

void ChartArea::restorePane(int index) {
    if (index < 0 || index >= m_count) return;
    if (!m_panes[index].minimized) return;
    m_panes[index].minimized = false;
    relayout();
    // Bringing a chart back is a choice to look at it, so it takes the
    // selection with it — otherwise the price strip stays on another pane.
    setActive(index);
}

void ChartArea::toggleMaximizePane(int index) {
    if (index < 0 || index >= m_count) return;
    if (m_maximized == index) {
        m_maximized = -1;
    } else {
        // Maximizing from the strip restores the pane on the way — the button
        // means "show me this chart", and a minimized one cannot be shown.
        m_panes[index].minimized = false;
        m_maximized = index;
        setActive(index);
    }
    relayout();
}

void ChartArea::refreshPaneHeaders() {
    for (int i = 0; i < m_panes.size(); ++i) {
        Pane& p = m_panes[i];
        if (!p.title) continue;
        p.title->setText(p.symbol.isEmpty()
                             ? tr("Chart %1").arg(i + 1)
                             : tr("Chart %1 — %2").arg(i + 1).arg(p.symbol));
        // Re-stamp the slot on every header part. Stale values here are how a
        // ✕ ends up closing the wrong chart after an earlier close shifted the
        // panes along.
        if (p.header)   p.header->setProperty("paneIndex", i);
        p.title->setProperty("paneIndex", i);
        if (p.minBtn)   p.minBtn->setProperty("paneIndex", i);
        if (p.maxBtn)   p.maxBtn->setProperty("paneIndex", i);
        if (p.closeBtn) p.closeBtn->setProperty("paneIndex", i);

        // Each control shows what it will DO next, not the state it is in.
        if (p.minBtn) {
            p.minBtn->setText(p.minimized ? QStringLiteral("▭")    // ▭ restore
                                          : QStringLiteral("–"));  // – minimize
            p.minBtn->setToolTip(p.minimized ? tr("Restore this chart")
                                             : tr("Minimize this chart"));
        }
        if (p.maxBtn) {
            const bool maxed = (m_maximized == i);
            p.maxBtn->setText(maxed ? QStringLiteral("❐")     // ❐ restore down
                                    : QStringLiteral("□"));   // □ maximize
            p.maxBtn->setToolTip(maxed ? tr("Restore this chart")
                                       : tr("Maximize this chart"));
        }
    }
}

void ChartArea::setActive(int index) {
    if (index < 0 || index >= m_count || index == m_active) return;
    // A pane in the minimized strip has no chart on screen for the one-click
    // strip to sit on, so it cannot be the active one.
    if (m_panes[index].minimized) return;
    m_active = index;
    paintPaneStates();
    refreshTabs();               // the active tab is the highlighted one
    if (m_overlay) setOverlayWidget(m_overlay);
    emit activeChartChanged(index);
    // Panes keep their own timeframes, so stepping between them moves the
    // toolbar highlight as surely as changing one does.
    emit activeResolutionChanged(activeResolution());
}

void ChartArea::onFocusChanged(QWidget* now) {
    for (QWidget* w = now; w; w = w->parentWidget()) {
        for (int i = 0; i < m_count; ++i) {
            if (m_panes[i].frame && w == m_panes[i].frame) { setActive(i); return; }
        }
    }
}

void ChartArea::paintPaneStates() {
    const auto& c = Theme::p();
    for (int i = 0; i < m_panes.size(); ++i) {
        Pane& p = m_panes[i];
        if (!p.frame) continue;
        const bool active = (i == m_active) && m_count > 1 && !p.minimized;
        // #chartPane, not a bare QFrame: the type selector matches subclasses,
        // and QLabel is one, so this border used to be drawn around every label
        // parented into the pane — the one-click strip's price tiles ended up
        // with a blue rectangle inside each button.
        p.frame->setStyleSheet(QString("QFrame#chartPane{background:%1; border:1px solid %2;}")
                               .arg(c.bg, active ? c.accent : c.border));
        if (p.header)
            p.header->setStyleSheet(QString("background:%1; border:none;")
                                    .arg(active ? c.cardSelBg : c.panelAlt));
        if (p.title)
            p.title->setStyleSheet(QString(
                "background:transparent; border:none; color:%1; font-size:10px; font-weight:700;")
                .arg(active ? c.textStrong : c.muted));
        // Minimize and maximize are reversible, so they hover to the accent
        // rather than to the destructive colour reserved for close.
        const QString ctrlCss = QString(
            "QToolButton{background:transparent; border:none; color:%1;"
            " font-size:10px; font-weight:700; padding:0;}"
            "QToolButton:hover{color:%2;}"
            "QToolButton:disabled{color:%3;}");
        if (p.minBtn) p.minBtn->setStyleSheet(ctrlCss.arg(c.muted, c.accent, c.dim));
        if (p.maxBtn) p.maxBtn->setStyleSheet(ctrlCss.arg(c.muted, c.accent, c.dim));
        if (p.closeBtn)
            // Muted until hovered, then `down` (the sell/red semantic) so the
            // destructive action reads as destructive without shouting for
            // attention in four headers at once.
            p.closeBtn->setStyleSheet(ctrlCss.arg(c.muted, c.down, c.dim));
    }
}

// ── the chart tabs ─────────────────────────────────────────────────────────

const QVector<QPair<QString, QString>>& ChartArea::timeframes() {
    // MetaTrader's name, then the charting library's resolution string.
    static const QVector<QPair<QString, QString>> kTf = {
        {QStringLiteral("M1"),  QStringLiteral("1")},
        {QStringLiteral("M5"),  QStringLiteral("5")},
        {QStringLiteral("M15"), QStringLiteral("15")},
        {QStringLiteral("M30"), QStringLiteral("30")},
        {QStringLiteral("H1"),  QStringLiteral("60")},
        {QStringLiteral("H4"),  QStringLiteral("240")},
        {QStringLiteral("D1"),  QStringLiteral("1D")},
        {QStringLiteral("W1"),  QStringLiteral("1W")},
        {QStringLiteral("MN"),  QStringLiteral("1M")},
    };
    return kTf;
}

QString ChartArea::timeframeLabel(const QString& res) {
    for (const auto& tf : timeframes())
        if (tf.second == res) return tf.first;
    return res;
}

void ChartArea::buildTabBar() {
    m_tabHost = new QWidget(this);
    m_tabLay = new QHBoxLayout(m_tabHost);
    m_tabLay->setContentsMargins(2, 0, 2, 0);
    m_tabLay->setSpacing(2);
    m_tabLay->addStretch(1);
}

void ChartArea::refreshTabs() {
    if (!m_tabLay) return;

    // Torn down and rebuilt. At most four tabs plus a +, so this is cheap, and
    // the alternative is keeping five widgets in step with a symbol that can
    // change from three different places.
    while (QLayoutItem* it = m_tabLay->takeAt(0)) {
        if (QWidget* w = it->widget()) w->deleteLater();
        delete it;
    }

    const auto& c = Theme::p();
    for (int i = 0; i < m_count; ++i) {
        const Pane& p = m_panes[i];
        const QString sym = p.symbol.isEmpty() ? tr("Chart %1").arg(i + 1) : p.symbol;
        const QString tf  = p.chart ? timeframeLabel(p.chart->resolution()) : QString();
        const QString title = tf.isEmpty() ? sym : QStringLiteral("%1,%2").arg(sym, tf);

        auto* tab = new QWidget(m_tabHost);
        auto* lay = new QHBoxLayout(tab);
        lay->setContentsMargins(8, 2, 4, 2);
        lay->setSpacing(4);

        auto* name = new QLabel(title, tab);
        lay->addWidget(name);

        auto* shut = new QToolButton(tab);
        shut->setText(QStringLiteral("✕"));
        shut->setCursor(Qt::PointingHandCursor);
        shut->setAutoRaise(true);
        shut->setFixedSize(14, 14);
        // The last chart cannot be closed — closePane() refuses it, and a ✕
        // that silently does nothing is worse than one that is plainly off.
        shut->setEnabled(m_count > 1);
        shut->setToolTip(tr("Close this chart"));
        connect(shut, &QToolButton::clicked, this, [this, i]() { closePane(i); });
        lay->addWidget(shut);

        const bool active = (i == m_active);
        tab->setStyleSheet(QString(
            "QWidget { background:%1; border:1px solid %2; border-bottom:none;"
            "          border-top-left-radius:4px; border-top-right-radius:4px; }"
            "QLabel { background:transparent; border:none; color:%3; font-size:11px; }"
            "QToolButton { background:transparent; border:none; color:%4; font-size:10px; }"
            "QToolButton:hover { color:%5; }")
            .arg(active ? c.panel : c.panelAlt,
                 active ? c.accent : c.border,
                 active ? c.textStrong : c.muted,
                 c.dim, c.down));
        // A click anywhere on the tab, not only on its text: the whole thing
        // looks like a button and a trader will aim at the middle of it.
        tab->installEventFilter(this);
        tab->setProperty("tabIndex", i);
        name->setProperty("tabIndex", i);
        name->installEventFilter(this);
        tab->setCursor(Qt::PointingHandCursor);

        m_tabLay->addWidget(tab);
    }

    // A new chart, MetaTrader's own "+" at the end of the row. Off once all
    // four panes are in use — the grid tiles 1, 2, 3 or 4 and no more.
    auto* plus = new QToolButton(m_tabHost);
    plus->setText(QStringLiteral("+"));
    plus->setAutoRaise(true);
    plus->setCursor(Qt::PointingHandCursor);
    plus->setFixedSize(18, 18);
    plus->setEnabled(m_count < 4);
    plus->setToolTip(m_count < 4 ? tr("New chart")
                                 : tr("Four charts is the most this grid holds"));
    plus->setStyleSheet(QString("QToolButton { border:none; color:%1; font-size:14px; }"
                                "QToolButton:hover { color:%2; }")
                        .arg(c.muted, c.textStrong));
    connect(plus, &QToolButton::clicked, this, [this]() {
        const int next = m_count + 1;
        if (next > 4) return;
        setChartCount(next);
        // Land on the chart that was just opened, which is what the click asked
        // for — otherwise the new pane appears and the selection stays put.
        setActive(next - 1);
    });
    m_tabLay->addWidget(plus);
    // Last, and re-added on every rebuild — the clear above takes the spacer
    // out with everything else. Without it the tabs share the whole width
    // between them and one chart gets a tab as wide as the window.
    m_tabLay->addStretch(1);

    m_tabHost->setStyleSheet(QString("background:%1;").arg(c.bg));
}

void ChartArea::showPaneFromTab(int index) {
    if (index < 0 || index >= m_count) return;
    if (m_panes[index].minimized) {
        restorePane(index);          // relayouts and refreshes the tabs itself
        setActive(index);
        return;
    }
    // One pane is being shown alone: the tab picks WHICH one. This is the whole
    // point of a tab bar — several charts open, one on screen — and it reuses
    // the maximize slot rather than inventing a second way to say the same.
    if (m_maximized >= 0 && m_maximized != index) {
        m_maximized = index;
        relayout();
    }
    setActive(index);
}

void ChartArea::applyTheme() {
    paintPaneStates();
    refreshTabs();
}

WebChartWidget* ChartArea::activeChart() const {
    return m_panes[m_active].chart;
}

void ChartArea::setActivePane(int index) { setActive(index); }

QString ChartArea::activeSymbol() const {
    return m_panes[m_active].symbol;
}

QStringList ChartArea::visibleSymbols() const {
    QStringList out;
    for (int i = 0; i < m_count && i < m_panes.size(); ++i)
        out << m_panes[i].symbol;
    return out;
}

QStringList ChartArea::chartStates() const {
    QStringList out;
    for (int i = 0; i < m_count && i < m_panes.size(); ++i)
        out << (m_panes[i].chart ? m_panes[i].chart->chartState() : QString());
    return out;
}

void ChartArea::setChartStates(const QStringList& states) {
    // The caller sets the pane count first, so the panes this walks are the
    // ones the profile asked for. A shorter list than the grid leaves the extra
    // panes showing whatever they already had, which is better than blanking
    // them: a profile saved on one chart should not wipe the other three.
    for (int i = 0; i < states.size() && i < m_count && i < m_panes.size(); ++i) {
        if (!m_panes[i].chart || states[i].isEmpty()) continue;
        m_panes[i].chart->setChartState(states[i]);
    }
}

QString ChartArea::studies() const {
    // Every pane reports the same list — it is the vendor bundle's, not the
    // chart's — so the active one answers for all of them. A pane still loading
    // returns an empty array, and the navigator refills when studiesChanged
    // arrives.
    WebChartWidget* c = activeChart();
    return c ? c->studies() : QStringLiteral("[]");
}

void ChartArea::addStudy(const QString& name) {
    if (WebChartWidget* c = activeChart()) c->createStudy(name);
}

// The timeframe and drawing toolbars act on the ACTIVE pane only, exactly as
// the Market Watch and the one-click strip already do. Applying either to every
// pane would make a four-chart grid useless: the whole point of it is four
// instruments on four timeframes at once.
void ChartArea::setResolution(const QString& res) {
    if (WebChartWidget* c = activeChart()) c->setResolution(res);
}

QString ChartArea::activeResolution() const {
    WebChartWidget* c = activeChart();
    return c ? c->resolution() : QString();
}

void ChartArea::selectLineTool(const QString& tool) {
    if (WebChartWidget* c = activeChart()) c->selectLineTool(tool);
}

void ChartArea::setDataWindow(bool on) {
    m_dataWindow = on;
    // A no-op per pane when the value is unchanged, so this cannot rebuild
    // charts needlessly — same contract as setCompact().
    for (Pane& p : m_panes)
        if (p.chart) p.chart->setDataWindow(on);
}

void ChartArea::setSymbols(const QVector<SymbolSpec>& symbols) {
    m_symbols = symbols;
    for (Pane& p : m_panes) if (p.chart) p.chart->setSymbols(symbols);
}

void ChartArea::setPositions(const QVector<OpenPosition>& positions) {
    m_positions = positions;
    // Every pane draws the position overlay, not just the active one: a
    // position on the symbol a background pane shows still has to be visible
    // and draggable there.
    for (Pane& p : m_panes) if (p.chart) p.chart->setPositions(positions);
}

void ChartArea::setTheme(const QString& theme) {
    for (Pane& p : m_panes) if (p.chart) p.chart->setTheme(theme);
}

void ChartArea::showSymbol(const QString& symbol) {
    Pane& p = m_panes[m_active];
    if (!p.chart) return;
    p.symbol = symbol;
    p.chart->showSymbol(symbol);
    refreshPaneHeaders();
    refreshTabs();          // the tab is titled from the symbol
}

void ChartArea::setOverlayWidget(QWidget* overlay) {
    m_overlay = overlay;
    if (!overlay) return;
    // setOverlayWidget() reparents, so handing it to the new pane is enough to
    // take it off the old one.
    if (WebChartWidget* c = activeChart()) c->setOverlayWidget(overlay);
}
