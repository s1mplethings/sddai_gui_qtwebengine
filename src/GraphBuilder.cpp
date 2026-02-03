#include "GraphBuilder.h"

#include <QDir>
#include <QFileInfo>
#include <QFileInfoList>
#include <QSet>

namespace {
QString edgeId(const QString &type, const QString &source, const QString &target) {
    return QString("%1:%2->%3").arg(type, source, target);
}

template <typename T>
bool containsId(const QList<T> &list, const QString &id, QString T::*field = &T::id) {
    for (const auto &item : list) {
        if (item.*field == id) return true;
    }
    return false;
}

GraphNode makePhaseNode(const MetaPhase &ph) {
    GraphNode n;
    n.id = ph.id;
    n.type = QStringLiteral("Phase");
    n.label = ph.label.isEmpty() ? ph.id : ph.label;
    n.meta.insert(QStringLiteral("order"), ph.order);
    n.parent.clear();
    n.view = QStringLiteral("Pipeline");
    return n;
}

GraphNode makeModuleNode(const ModuleSpec &ms, const MetaModule *meta) {
    GraphNode n;
    n.id = ms.id;
    n.type = QStringLiteral("Module");
    n.label = meta && !meta->label.isEmpty() ? meta->label : (!ms.label.isEmpty() ? ms.label : ms.id);
    n.phase = meta ? meta->phase : ms.phase;
    n.path = ms.path;
    n.parent = n.phase;
    n.view = QStringLiteral("Pipeline");
    if (meta) {
        n.tier = meta->tier;
        n.mutableFlag = meta->mutableFlag;
        n.pinned = meta->pinned;
        n.category = meta->category;
    }
    return n;
}

GraphNode makeContractNode(const ContractSchema &cs, const MetaContract *meta) {
    GraphNode n;
    n.id = cs.id;
    n.type = QStringLiteral("Contract");
    n.label = meta && !meta->label.isEmpty() ? meta->label : (!cs.label.isEmpty() ? cs.label : cs.id);
    n.path = meta && !meta->schemaPath.isEmpty() ? meta->schemaPath : cs.schemaPath;
    n.view = QStringLiteral("Pipeline");
    if (meta) {
        n.tier = meta->tier;
        n.mutableFlag = meta->mutableFlag;
        n.pinned = meta->pinned;
        n.category = meta->category;
    }
    return n;
}

GraphNode makeRunNode(const RunInfo &ri) {
    GraphNode n;
    n.id = QStringLiteral("run:%1").arg(ri.id);
    n.type = QStringLiteral("Run");
    n.label = ri.id;
    n.statusFlags << ri.status;
    n.meta.insert(QStringLiteral("path"), ri.path);
    if (!ri.startTime.isEmpty()) n.meta.insert(QStringLiteral("start_time"), ri.startTime);
    n.view = QStringLiteral("Pipeline");
    return n;
}
} // namespace

Graph GraphBuilder::build(const ProjectLayout &layout,
                          const QList<ModuleSpec> &modules,
                          const QList<ContractSchema> &contracts,
                          const MetaGraph &meta,
                          const RunState &runs) const {
    Graph g;
    g.schemaVersion = meta.schemaVersion.isEmpty() ? QStringLiteral("1.0.0") : meta.schemaVersion;

    // Phase nodes (in both Pipeline and Docs views)
    for (const auto &ph : meta.phases) {
        g.nodes << makePhaseNode(ph);
    }

    // Index meta modules/contracts by id for overrides
    QHash<QString, MetaModule> metaModules;
    for (const auto &m : meta.modules) metaModules.insert(m.id, m);
    QHash<QString, MetaContract> metaContracts;
    for (const auto &c : meta.contracts) metaContracts.insert(c.id, c);

    // Module nodes
    for (const auto &ms : modules) {
        const MetaModule *mm = metaModules.contains(ms.id) ? &metaModules[ms.id] : nullptr;
        g.nodes << makeModuleNode(ms, mm);
    }
    // Meta-only modules
    for (const auto &mm : meta.modules) {
        if (!containsId(modules, mm.id)) {
            ModuleSpec dummy;
            dummy.id = mm.id;
            dummy.label = mm.label;
            dummy.path = mm.path;
            dummy.phase = mm.phase;
            g.nodes << makeModuleNode(dummy, &mm);
        }
    }

    // Contract nodes
    for (const auto &cs : contracts) {
        const MetaContract *mc = metaContracts.contains(cs.id) ? &metaContracts[cs.id] : nullptr;
        g.nodes << makeContractNode(cs, mc);
    }
    for (const auto &mc : meta.contracts) {
        if (!containsId(contracts, mc.id, &ContractSchema::id)) {
            ContractSchema dummy{mc.id, mc.label, mc.schemaPath};
            g.nodes << makeContractNode(dummy, &mc);
        }
    }

    // Doc nodes (use meta/doc view ids; parent Docs phase if exists)
    if (!layout.docsRoot.isEmpty()) {
        QDir docs(layout.docsRoot);
        const auto docFiles = docs.entryInfoList(QStringList() << "*.md", QDir::Files);
        for (const auto &f : docFiles) {
            GraphNode n;
            const QString base = f.completeBaseName();
            n.id = QStringLiteral("doc:%1").arg(base);
            n.type = QStringLiteral("Doc");
            n.label = f.fileName();
            n.path = f.absoluteFilePath();
            n.parent = QStringLiteral("Docs");
            n.view = QStringLiteral("Docs");
            n.category = QStringLiteral("Docs");
            g.nodes << n;
        }
    }

    // Run nodes
    for (const auto &ri : runs.runs) {
        g.nodes << makeRunNode(ri);
    }

    QSet<QString> edgeIds;
    auto addEdge = [&](const GraphEdge &e) {
        if (edgeIds.contains(e.id)) return;
        edgeIds.insert(e.id);
        g.edges << e;
    };

    // Phase contains edges
    for (const auto &n : g.nodes) {
        if (n.type == QStringLiteral("Module") && !n.phase.isEmpty()) {
            GraphEdge e;
            e.id = edgeId(QStringLiteral("phase_contains"), n.phase, n.id);
            e.source = n.phase;
            e.target = n.id;
            e.type = QStringLiteral("phase_contains");
            e.view = QStringLiteral("Pipeline");
            addEdge(e);
        }
    }

    // Meta edges (manual)
    for (const auto &me : meta.edges) {
        GraphEdge e;
        e.id = !me.id.isEmpty() ? me.id : edgeId(me.type, me.source, me.target);
        e.source = me.source;
        e.target = me.target;
        e.type = me.type;
        e.label = me.label;
        e.confidence = QStringLiteral("manual");
        e.view = (me.type == QStringLiteral("docs_link")) ? QStringLiteral("Docs") : QStringLiteral("Pipeline");
        addEdge(e);
    }

    // Auto edges from module specs
    QSet<QString> contractIds;
    for (const auto &c : g.nodes) {
        if (c.type == QStringLiteral("Contract")) contractIds.insert(c.id);
    }
    auto addAutoEdge = [&](const QString &type, const QString &source, const QString &target) {
        GraphEdge e;
        e.id = edgeId(type, source, target);
        e.source = source;
        e.target = target;
        e.type = type;
        e.confidence = QStringLiteral("auto");
        addEdge(e);
    };

    for (const auto &ms : modules) {
        // produces: module -> contract
        for (const auto &out : ms.outputs) {
            const QString contractId = contractIds.contains(out) ? out : out.section('.', 0, 0);
            if (!contractId.isEmpty()) addAutoEdge(QStringLiteral("produces"), ms.id, contractId);
        }
        // consumes: contract -> module
        for (const auto &in : ms.inputs) {
            const QString contractId = contractIds.contains(in) ? in : in.section('.', 0, 0);
            if (!contractId.isEmpty()) addAutoEdge(QStringLiteral("consumes"), contractId, ms.id);
        }
        // verifies: module -> contract/gate (best-effort)
        for (const auto &v : ms.verifies) {
            const QString target = contractIds.contains(v) ? v : v.section('.', 0, 0);
            if (!target.isEmpty()) addAutoEdge(QStringLiteral("verifies"), ms.id, target);
        }
    }

    // Doc link edges (simple chain)
    if (!layout.docsRoot.isEmpty()) {
        QDir docs(layout.docsRoot);
        auto docFiles = docs.entryList(QStringList() << "*.md", QDir::Files, QDir::Name);
        for (int i = 1; i < docFiles.size(); ++i) {
            const QString src = QStringLiteral("doc:%1").arg(QFileInfo(docFiles[i - 1]).completeBaseName());
            const QString dst = QStringLiteral("doc:%1").arg(QFileInfo(docFiles[i]).completeBaseName());
            GraphEdge e;
            e.id = edgeId(QStringLiteral("docs_link"), src, dst);
            e.source = src;
            e.target = dst;
            e.type = QStringLiteral("docs_link");
            e.confidence = QStringLiteral("low");
            e.view = QStringLiteral("Docs");
            addEdge(e);
        }
    }

    // Run touches (placeholder: connect run to modules)
    if (!runs.runs.isEmpty() && !modules.isEmpty()) {
        for (const auto &ri : runs.runs) {
            const QString runId = QStringLiteral("run:%1").arg(ri.id);
            for (const auto &ms : modules) {
                GraphEdge e;
                e.id = edgeId(QStringLiteral("run_touches"), runId, ms.id);
                e.source = runId;
                e.target = ms.id;
                e.type = QStringLiteral("run_touches");
                e.confidence = QStringLiteral("low");
                e.view = QStringLiteral("Pipeline");
                addEdge(e);
            }
        }
    }

    return g;
}
