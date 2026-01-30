#include "sddai_bridge.h"

#include "Bridge.h"
#include "preview_window.h"

#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QCoreApplication>
#include <QUrl>

SddaiBridge::SddaiBridge(Bridge* core, QObject* parent)
    : QObject(parent), core_(core) {}

void SddaiBridge::setProjectRoot(const QString& projectRoot) { projectRoot_ = QDir(projectRoot).absolutePath(); }

static Qt::CaseSensitivity sddaiPathCaseSensitivity() {
#ifdef Q_OS_WIN
  return Qt::CaseInsensitive;
#else
  return Qt::CaseSensitive;
#endif
}

QString SddaiBridge::resolveSafePath(const QString& relativePath) const {
  const QString rootAbs = QDir(projectRoot_).absolutePath();
  if (rootAbs.isEmpty()) return QString();

  QString cleaned = QDir::cleanPath(relativePath.trimmed());
  if (cleaned.isEmpty()) return QString();

  if (cleaned.startsWith("qrc:", sddaiPathCaseSensitivity()) ||
      cleaned.startsWith(":", sddaiPathCaseSensitivity()) ||
      cleaned.startsWith("http:", sddaiPathCaseSensitivity()) ||
      cleaned.startsWith("https:", sddaiPathCaseSensitivity())) {
    return QString();
  }

  const QString candidateAbs = QDir::isAbsolutePath(cleaned)
      ? QFileInfo(cleaned).absoluteFilePath()
      : QFileInfo(QDir(rootAbs).filePath(cleaned)).absoluteFilePath();

  const QString rel = QDir(rootAbs).relativeFilePath(candidateAbs);
  if (rel.startsWith("..", sddaiPathCaseSensitivity()) || QDir::isAbsolutePath(rel))
    return QString();

  return candidateAbs;
}

QString SddaiBridge::readTextFile(const QString& relativePath) const {
  const QString absPath = resolveSafePath(relativePath);
  if (absPath.isEmpty()) return QString();

  QFile f(absPath);
  if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) return QString();

  const qint64 MAX_BYTES = 2LL * 1024 * 1024;
  QByteArray data = f.read(MAX_BYTES + 1);
  if (data.size() > MAX_BYTES) data = data.left(MAX_BYTES);

  return QString::fromUtf8(data);
}

static bool sddaiIsMarkdown(const QString& absPath) {
  const QString lower = absPath.toLower();
  return lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdown");
}

QString SddaiBridge::requestGraph(const QString& view, const QString& focus) const {
  if (core_) {
    return core_->requestGraph(view, focus);
  }
  QJsonObject root;
  root["view"] = view;
  root["focus"] = focus;
  root["nodes"] = QJsonArray();
  root["edges"] = QJsonArray();
  return QString::fromUtf8(QJsonDocument(root).toJson(QJsonDocument::Compact));
}

void SddaiBridge::openPath(const QString& relativePath) {
  const QString absPath = resolveSafePath(relativePath);
  if (absPath.isEmpty()) return;

  if (sddaiIsMarkdown(absPath)) {
    QFile f(absPath);
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) return;
    const QString text = QString::fromUtf8(f.readAll());

    if (!preview_) {
      preview_ = new PreviewWindow(qobject_cast<QWidget*>(parent()));
      preview_->setAttribute(Qt::WA_DeleteOnClose, false);
    }

    preview_->loadFile(absPath, text);
    preview_->show();
    preview_->raise();
    preview_->activateWindow();
    return;
  }

  QDesktopServices::openUrl(QUrl::fromLocalFile(absPath));
}


bool SddaiBridge::copyAidocTemplate(const QString& targetDir) const {
  const QString repoRoot = QDir(projectRoot_).isAbsolute() && !projectRoot_.isEmpty()
      ? QDir(projectRoot_).absolutePath()
      : QDir(QCoreApplication::applicationDirPath()).absoluteFilePath("..");
  const QString tplDir = QDir(repoRoot).absoluteFilePath("ai_context/templates/aidoc");
  if (!QDir(tplDir).exists()) return false;

  QDir dst(QDir(targetDir).absoluteFilePath("docs/aidoc"));
  if (!dst.exists()) dst.mkpath(".");

  const QStringList files = QDir(tplDir).entryList(QStringList() << "*.md", QDir::Files);
  for (const QString& f : files) {
    const QString srcPath = QDir(tplDir).absoluteFilePath(f);
    const QString dstPath = dst.absoluteFilePath(f);
    if (QFile::exists(dstPath)) {
      QFile::remove(dstPath + ".bak");
      QFile::copy(dstPath, dstPath + ".bak");
    }
    QFile::remove(dstPath);
    if (!QFile::copy(srcPath, dstPath)) return false;
  }
  return true;
}

bool SddaiBridge::generateAidoc(const QString& targetPath) {
  if (targetPath.isEmpty()) return false;
  const QString abs = QDir(targetPath).absolutePath();
  const QString rel = QDir(projectRoot_).relativeFilePath(abs);
  if (!projectRoot_.isEmpty() && (rel.startsWith("..", Qt::CaseInsensitive) || QDir::isAbsolutePath(rel))) {
    // 允许外部目录，但仍需是本地路径
  }
  const bool ok = copyAidocTemplate(abs);
  return ok;
}


QString SddaiBridge::getGraphJson() const {
  // 优先复用核心桥接生成的 Summary 视图；如为空则返回内置 demo graph。
  if (core_) {
    const QString json = core_->requestGraph(QStringLiteral("Summary"), QString());
    if (!json.isEmpty()) return json;
  }
  QFile demo(QStringLiteral(":/web/graph_spider/demo_graph.json"));
  if (demo.open(QIODevice::ReadOnly | QIODevice::Text)) {
    return QString::fromUtf8(demo.readAll());
  }
  return QString();
}

void SddaiBridge::openNode(const QString& nodeJson) {
  QJsonParseError err{};
  const QJsonDocument doc = QJsonDocument::fromJson(nodeJson.toUtf8(), &err);
  if (err.error != QJsonParseError::NoError || !doc.isObject()) {
    return;
  }
  const QJsonObject obj = doc.object();
  const QString path = obj.value(QStringLiteral("path")).toString();
  if (!path.isEmpty()) {
    openPath(path);
  }
}
