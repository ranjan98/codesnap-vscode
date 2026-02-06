import * as vscode from 'vscode';
import * as path from 'path';

let currentPanel: vscode.WebviewPanel | undefined;
let shikiHighlighter: any = null;

interface ThemeConfig {
  bg: string;
  headerBg: string;
  lineNumColor: string;
  borderColor: string;
  titleColor: string;
  shikiTheme: string;
}

const themeConfigs: Record<string, ThemeConfig> = {
  dark:    { bg: '#1e1e1e', headerBg: '#2d2d2d', lineNumColor: '#858585', borderColor: '#333333', titleColor: '#999999', shikiTheme: 'dark-plus' },
  light:   { bg: '#ffffff', headerBg: '#e8e8e8', lineNumColor: '#999999', borderColor: '#dddddd', titleColor: '#666666', shikiTheme: 'light-plus' },
  monokai: { bg: '#272822', headerBg: '#1e1f1c', lineNumColor: '#75715e', borderColor: '#3e3d32', titleColor: '#a6a28c', shikiTheme: 'monokai' },
  nord:    { bg: '#2e3440', headerBg: '#3b4252', lineNumColor: '#4c566a', borderColor: '#4c566a', titleColor: '#7b88a1', shikiTheme: 'nord' },
  dracula: { bg: '#282a36', headerBg: '#21222c', lineNumColor: '#6272a4', borderColor: '#44475a', titleColor: '#6272a4', shikiTheme: 'dracula' },
};

async function getHighlightedHtml(code: string, language: string, themeName: string): Promise<string> {
  const config = themeConfigs[themeName] || themeConfigs.dark;
  try {
    const shiki = require('shiki');
    if (!shikiHighlighter) {
      shikiHighlighter = await shiki.createHighlighter({
        themes: Object.values(themeConfigs).map(t => t.shikiTheme),
        langs: ['javascript', 'typescript', 'python', 'json', 'html', 'css', 'markdown', 'bash'],
      });
    }

    const loadedLangs: string[] = shikiHighlighter.getLoadedLanguages();
    let lang = language;
    if (!loadedLangs.includes(lang)) {
      try {
        await shikiHighlighter.loadLanguage(lang);
      } catch {
        // Language not supported, return plain text
        return `<pre style="margin:0"><code>${escapeHtml(code)}</code></pre>`;
      }
    }

    return shikiHighlighter.codeToHtml(code, {
      lang,
      theme: config.shikiTheme,
    });
  } catch (err) {
    console.error('CodeSnap: Shiki highlighting failed:', err);
    return `<pre style="margin:0"><code>${escapeHtml(code)}</code></pre>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('CodeSnap extension is now active');

  const captureSelection = vscode.commands.registerCommand(
    'codesnap.captureSelection',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showErrorMessage('No code selected. Select some code first.');
        return;
      }

      const code = editor.document.getText(selection);
      const language = editor.document.languageId;
      const fileName = path.basename(editor.document.fileName);
      const startLine = selection.start.line + 1;

      await showCodeSnapPanel(context, code, language, fileName, startLine);
    }
  );

  const captureFile = vscode.commands.registerCommand(
    'codesnap.captureFile',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      const code = editor.document.getText();
      const language = editor.document.languageId;
      const fileName = path.basename(editor.document.fileName);

      await showCodeSnapPanel(context, code, language, fileName, 1);
    }
  );

  context.subscriptions.push(captureSelection, captureFile);
}

async function showCodeSnapPanel(
  context: vscode.ExtensionContext,
  code: string,
  language: string,
  fileName: string,
  startLine: number
) {
  const vsConfig = vscode.workspace.getConfiguration('codesnap');
  const theme = vsConfig.get<string>('theme', 'dark');
  const showLineNumbers = vsConfig.get<boolean>('showLineNumbers', true) as boolean;
  const windowControls = vsConfig.get<boolean>('windowControls', true) as boolean;
  const shadow = vsConfig.get<boolean>('shadow', true) as boolean;

  const highlightedHtml = await getHighlightedHtml(code, language, theme);

  if (!currentPanel) {
    currentPanel = vscode.window.createWebviewPanel(
      'codesnap',
      'CodeSnap Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'node_modules'),
        ],
      }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });

    // Message handler registered once when panel is created
    currentPanel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'copy') {
          vscode.window.showInformationMessage('Screenshot copied to clipboard!');
        } else if (message.command === 'save' && message.data) {
          const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || require('os').homedir();
          const uri = await vscode.window.showSaveDialog({
            filters: { 'PNG Images': ['png'] },
            defaultUri: vscode.Uri.file(
              path.join(defaultDir, `${message.fileName || 'codesnap'}.png`)
            ),
          });
          if (uri) {
            const base64 = message.data.replace(/^data:image\/png;base64,/, '');
            await vscode.workspace.fs.writeFile(uri, Buffer.from(base64, 'base64'));
            vscode.window.showInformationMessage(`Screenshot saved to ${uri.fsPath}`);
          }
        } else if (message.command === 'error') {
          vscode.window.showErrorMessage(`CodeSnap: ${message.text}`);
        }
      },
      undefined,
      context.subscriptions
    );
  } else {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  }

  // Load html2canvas from local node_modules
  const html2canvasUri = currentPanel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js')
  );
  const nonce = getNonce();
  const cspSource = currentPanel.webview.cspSource;

  currentPanel.webview.html = buildWebviewHtml({
    highlightedHtml,
    code,
    fileName,
    startLine,
    theme,
    showLineNumbers,
    windowControls,
    shadow,
    html2canvasUri: html2canvasUri.toString(),
    nonce,
    cspSource,
  });
}

interface WebviewParams {
  highlightedHtml: string;
  code: string;
  fileName: string;
  startLine: number;
  theme: string;
  showLineNumbers: boolean;
  windowControls: boolean;
  shadow: boolean;
  html2canvasUri: string;
  nonce: string;
  cspSource: string;
}

function buildWebviewHtml(params: WebviewParams): string {
  const {
    highlightedHtml, code, fileName, startLine, theme,
    showLineNumbers, windowControls, shadow,
    html2canvasUri, nonce, cspSource,
  } = params;

  const config = themeConfigs[theme] || themeConfigs.dark;
  const isDark = theme !== 'light';
  const lines = code.split('\n');

  const lineNumbersHtml = showLineNumbers
    ? lines.map((_, i) => `<div class="line-number">${startLine + i}</div>`).join('')
    : '';

  const fileNameForJs = JSON.stringify(fileName.replace(/\.[^/.]+$/, '') + '-codesnap');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${cspSource}; style-src 'unsafe-inline'; img-src data:;">
  <script nonce="${nonce}" src="${html2canvasUri}"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      padding: 40px;
      background: ${isDark ? '#0d1117' : '#f5f5f5'};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
    }

    .toolbar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }

    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .btn-primary { background: #238636; color: white; }
    .btn-primary:hover { background: #2ea043; }
    .btn-secondary {
      background: ${isDark ? '#21262d' : '#e1e4e8'};
      color: ${isDark ? '#c9d1d9' : '#24292e'};
      border: 1px solid ${isDark ? '#30363d' : '#d1d5da'};
    }
    .btn-secondary:hover { background: ${isDark ? '#30363d' : '#d1d5da'}; }

    .preview-container { display: inline-block; }

    .code-container {
      display: inline-block;
      background: ${config.bg};
      border-radius: 12px;
      overflow: hidden;
      ${shadow ? 'box-shadow: 0 20px 68px rgba(0,0,0,0.55);' : ''}
    }

    .window-header {
      padding: 12px 16px;
      background: ${config.headerBg};
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .window-dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }
    .window-title { margin-left: 12px; color: ${config.titleColor}; font-size: 13px; }

    .code-wrapper {
      display: flex;
      padding: 20px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace;
      font-size: 14px;
      line-height: 1.6;
    }

    .line-numbers {
      padding-right: 16px;
      text-align: right;
      color: ${config.lineNumColor};
      user-select: none;
      border-right: 1px solid ${config.borderColor};
      margin-right: 16px;
      flex-shrink: 0;
    }

    .line-number { line-height: 1.6; }

    .code-content { white-space: pre; overflow-x: auto; flex: 1; }

    .code-content pre {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
    }

    .code-content code {
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
    }

    .code-content .line {
      display: block;
      line-height: 1.6;
      min-height: 1em;
    }

    .hint { margin-top: 20px; color: #8b949e; font-size: 12px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn btn-primary" onclick="saveImage()">Save as PNG</button>
    <button class="btn btn-secondary" onclick="copyImage()">Copy to Clipboard</button>
  </div>

  <div class="preview-container">
    <div class="code-container" id="capture">
      ${windowControls ? `
      <div class="window-header">
        <div class="window-dot dot-red"></div>
        <div class="window-dot dot-yellow"></div>
        <div class="window-dot dot-green"></div>
        <span class="window-title">${escapeHtml(fileName)}</span>
      </div>
      ` : ''}
      <div class="code-wrapper">
        ${showLineNumbers ? `<div class="line-numbers">${lineNumbersHtml}</div>` : ''}
        <div class="code-content">${highlightedHtml}</div>
      </div>
    </div>
  </div>

  <p class="hint">Tip: Adjust theme, line numbers, and more in VS Code Settings &rarr; Extensions &rarr; CodeSnap</p>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    async function captureElement() {
      const element = document.getElementById('capture');
      return html2canvas(element, { backgroundColor: null, scale: 2 });
    }

    async function saveImage() {
      try {
        const canvas = await captureElement();
        const dataUrl = canvas.toDataURL('image/png');
        vscode.postMessage({
          command: 'save',
          data: dataUrl,
          fileName: ${fileNameForJs}
        });
      } catch (err) {
        vscode.postMessage({ command: 'error', text: 'Failed to capture image: ' + err.message });
      }
    }

    async function copyImage() {
      try {
        const canvas = await captureElement();
        canvas.toBlob(async (blob) => {
          if (blob) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
              ]);
              vscode.postMessage({ command: 'copy' });
            } catch (clipErr) {
              vscode.postMessage({ command: 'error', text: 'Clipboard access denied. Use Save as PNG instead.' });
            }
          }
        });
      } catch (err) {
        vscode.postMessage({ command: 'error', text: 'Failed to capture image: ' + err.message });
      }
    }
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function deactivate() {
  if (shikiHighlighter) {
    try { shikiHighlighter.dispose(); } catch {}
    shikiHighlighter = null;
  }
}
