#include "ui/SymbolsDialog.h"
#include "ui/Theme.h"

#include <QDialogButtonBox>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLineEdit>
#include <QMap>
#include <QPushButton>
#include <QTreeWidget>
#include <QVBoxLayout>

namespace {
// Roles on the symbol rows. The category rows carry neither, which is how the
// walkers below tell the two apart without relying on depth.
constexpr int SymbolRole = Qt::UserRole + 1;
}  // namespace

SymbolsDialog::SymbolsDialog(const QVector<SymbolSpec>& symbols,
                             const QStringList& hidden, QWidget* parent)
    : QDialog(parent) {
    setWindowTitle(tr("Symbols"));
    setModal(true);
    resize(520, 620);

    const auto& p = Theme::p();
    setStyleSheet(QString(
        "QDialog { background:%1; }"
        "QLabel { color:%2; }"
        "QLineEdit { background:%3; color:%2; border:1px solid %4;"
        "            border-radius:6px; padding:6px 9px; }"
        "QLineEdit:focus { border-color:%5; }"
        "QTreeWidget { background:%6; color:%2; border:1px solid %4;"
        "              border-radius:6px; }"
        "QTreeWidget::item { padding:3px 2px; }")
        .arg(p.bg, p.text, p.inputBg, p.inputBorder, p.accent, p.tableBg));

    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(16, 14, 16, 14);
    root->setSpacing(10);

    auto* intro = new QLabel(tr("Tick the instruments you want in Market Watch."));
    intro->setStyleSheet(QString("color:%1; font-size:12px;").arg(p.muted));
    root->addWidget(intro);

    m_search = new QLineEdit;
    m_search->setPlaceholderText(tr("Search instruments…"));
    m_search->setClearButtonEnabled(true);
    connect(m_search, &QLineEdit::textChanged, this, &SymbolsDialog::applyFilter);
    root->addWidget(m_search);

    m_tree = new QTreeWidget;
    m_tree->setColumnCount(2);
    m_tree->setHeaderLabels({tr("Symbol"), tr("Description")});
    m_tree->setRootIsDecorated(true);
    m_tree->setUniformRowHeights(true);
    m_tree->setAlternatingRowColors(false);
    m_tree->header()->setSectionResizeMode(0, QHeaderView::ResizeToContents);
    m_tree->header()->setSectionResizeMode(1, QHeaderView::Stretch);
    root->addWidget(m_tree, 1);

    build(symbols, hidden);

    connect(m_tree, &QTreeWidget::itemChanged, this, [this]() { updateCount(); });
    // Double-click opens the contract terms, which is MT5's gesture here too.
    connect(m_tree, &QTreeWidget::itemDoubleClicked, this,
            [this](QTreeWidgetItem* item, int) {
        const QString sym = item->data(0, SymbolRole).toString();
        if (!sym.isEmpty()) emit specificationRequested(sym);
    });

    auto* tools = new QHBoxLayout;
    tools->setSpacing(8);
    auto* showAll = new QPushButton(tr("Show all"));
    auto* hideAll = new QPushButton(tr("Hide all"));
    auto* spec    = new QPushButton(tr("Specification…"));
    for (QPushButton* b : {showAll, hideAll, spec}) b->setCursor(Qt::PointingHandCursor);
    connect(showAll, &QPushButton::clicked, this, [this]() { setAllVisibleChecked(true); });
    connect(hideAll, &QPushButton::clicked, this, [this]() { setAllVisibleChecked(false); });
    connect(spec, &QPushButton::clicked, this, [this]() {
        QTreeWidgetItem* item = m_tree->currentItem();
        if (!item) return;
        const QString sym = item->data(0, SymbolRole).toString();
        if (!sym.isEmpty()) emit specificationRequested(sym);
    });
    tools->addWidget(showAll);
    tools->addWidget(hideAll);
    tools->addWidget(spec);
    tools->addStretch(1);
    m_count = new QLabel;
    m_count->setStyleSheet(QString("color:%1; font-size:12px;").arg(p.muted));
    tools->addWidget(m_count);
    root->addLayout(tools);

    auto* buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
    connect(buttons, &QDialogButtonBox::accepted, this, &QDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::reject);
    root->addWidget(buttons);

    updateCount();
}

void SymbolsDialog::build(const QVector<SymbolSpec>& symbols, const QStringList& hidden) {
    // QMap rather than QHash so the groups come out in a stable, alphabetical
    // order — a list of instruments that reshuffles between openings is worse
    // than one in an order nobody chose.
    QMap<QString, QVector<SymbolSpec>> byCategory;
    for (const SymbolSpec& s : symbols) {
        const QString cat = s.category.trimmed().isEmpty() ? tr("Other")
                                                           : s.category.trimmed();
        byCategory[cat].append(s);
    }

    for (auto it = byCategory.begin(); it != byCategory.end(); ++it) {
        auto* group = new QTreeWidgetItem(m_tree, {it.key(), QString()});
        // Not user-checkable: a tri-state parent would let a click set a
        // hundred instruments at once by accident. Show all / Hide all are the
        // deliberate way to do that.
        group->setFlags(group->flags() & ~Qt::ItemIsSelectable);
        QFont f = group->font(0);
        f.setBold(true);
        group->setFont(0, f);

        for (const SymbolSpec& s : it.value()) {
            auto* row = new QTreeWidgetItem(group, {s.symbol, s.displayName});
            row->setData(0, SymbolRole, s.symbol);
            row->setFlags(row->flags() | Qt::ItemIsUserCheckable);
            row->setCheckState(0, hidden.contains(s.symbol) ? Qt::Unchecked : Qt::Checked);
        }
        group->setExpanded(true);
    }
}

void SymbolsDialog::applyFilter(const QString& text) {
    const QString needle = text.trimmed();
    for (int g = 0; g < m_tree->topLevelItemCount(); ++g) {
        QTreeWidgetItem* group = m_tree->topLevelItem(g);
        int shown = 0;
        for (int i = 0; i < group->childCount(); ++i) {
            QTreeWidgetItem* row = group->child(i);
            const bool match =
                needle.isEmpty() ||
                row->text(0).contains(needle, Qt::CaseInsensitive) ||
                row->text(1).contains(needle, Qt::CaseInsensitive);
            row->setHidden(!match);
            if (match) ++shown;
        }
        // A group with nothing left in it goes too, rather than sitting there
        // as an empty heading.
        group->setHidden(shown == 0);
        if (!needle.isEmpty() && shown > 0) group->setExpanded(true);
    }
}

void SymbolsDialog::setAllVisibleChecked(bool on) {
    for (int g = 0; g < m_tree->topLevelItemCount(); ++g) {
        QTreeWidgetItem* group = m_tree->topLevelItem(g);
        if (group->isHidden()) continue;
        for (int i = 0; i < group->childCount(); ++i) {
            QTreeWidgetItem* row = group->child(i);
            if (row->isHidden()) continue;
            row->setCheckState(0, on ? Qt::Checked : Qt::Unchecked);
        }
    }
    updateCount();
}

void SymbolsDialog::updateCount() {
    int shown = 0, total = 0;
    for (int g = 0; g < m_tree->topLevelItemCount(); ++g) {
        QTreeWidgetItem* group = m_tree->topLevelItem(g);
        for (int i = 0; i < group->childCount(); ++i) {
            ++total;
            if (group->child(i)->checkState(0) == Qt::Checked) ++shown;
        }
    }
    m_count->setText(tr("%1 of %2 in Market Watch").arg(shown).arg(total));
}

QStringList SymbolsDialog::hiddenSymbols() const {
    QStringList out;
    for (int g = 0; g < m_tree->topLevelItemCount(); ++g) {
        QTreeWidgetItem* group = m_tree->topLevelItem(g);
        for (int i = 0; i < group->childCount(); ++i) {
            QTreeWidgetItem* row = group->child(i);
            if (row->checkState(0) == Qt::Unchecked)
                out << row->data(0, SymbolRole).toString();
        }
    }
    return out;
}
