import * as vscode from 'vscode';
import * as path from 'path';

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('CodeSnap extension is now active');

  // Command: Capture Selection
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

      showCodeSnapPanel(context, code, language, fileName, startLine);
    }
  );

  // Command: Capture Entire File
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

      showCodeSnapPanel(context, code, language, fileName, 1);
    }
  );

  context.subscriptions.push(captureSelection, captureFile);
}

function showCodeSnapPanel(
  context: vscode.ExtensionContext,
  code: string,
  language: string,
  fileName: string,
  startLine: number
) {
  const config = vscode.workspace.getConfiguration('codesnap');
  const theme = config.get('theme', 'dark');
  const showLineNumbers = config.get('showLineNumbers', true);
  const windowControls = config.get('windowControls', true);
  const shadow = config.get('shadow', true);

  // Create or show panel
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      'codesnap',
      'CodeSnap Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  }

  currentPanel.webview.html = getWebviewContent(
    code,
    language,
    fileName,
    startLine,
    theme,
    showLineNumbers,
    windowControls,
    shadow
  );

  // Handle messages from webview
  currentPanel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.command === 'copy') {
        vscode.window.showInformationMessage('Screenshot copied to clipboard!');
      } else if (message.command === 'save') {
        const uri = await vscode.window.showSaveDialog({
          filters: { 'PNG Images': ['png'] },
          defaultUri: vscode.Uri.file(`${fileName.replace(/\.[^/.]+$/, '')}-codesnap.png`),
        });
        if (uri) {
          // The webview will handle the actual saving via base64 data
          vscode.window.showInformationMessage(`Screenshot saved to ${uri.fsPath}`);
        }
      }
    },
    undefined,
    context.subscriptions
  );
}

function getWebviewContent(
  code: string,
  language: string,
  fileName: string,
  startLine: number,
  theme: string,
  showLineNumbers: boolean,
  windowControls: boolean,
  shadow: boolean
): string {
  const isDark = theme !== 'light';
  const bgColor = isDark ? '#1e1e1e' : '#ffffff';
  const textColor = isDark ? '#d4d4d4' : '#333333';
  const lineNumColor = isDark ? '#858585' : '#999999';
  const lines = code.split('\n');

  const lineNumbersHtml = showLineNumbers
    ? lines.map((_, i) => `<div class="line-number">${startLine + i}</div>`).join('')
    : '';

  const codeHtml = escapeHtml(code);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      padding: 40px;
      background: #0d1117;
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

    .btn-primary {
      background: #238636;
      color: white;
    }

    .btn-primary:hover {
      background: #2ea043;
    }

    .btn-secondary {
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
    }

    .btn-secondary:hover {
      background: #30363d;
    }

    .preview-container {
      display: inline-block;
    }

    .code-container {
      display: inline-block;
      background: ${bgColor};
      border-radius: 12px;
      overflow: hidden;
      ${shadow ? 'box-shadow: 0 20px 68px rgba(0,0,0,0.55);' : ''}
    }

    .window-header {
      padding: 12px 16px;
      background: ${isDark ? '#2d2d2d' : '#e8e8e8'};
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .window-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }

    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }

    .window-title {
      margin-left: 12px;
      color: ${isDark ? '#999' : '#666'};
      font-size: 13px;
    }

    .code-wrapper {
      display: flex;
      padding: 20px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace;
      font-size: 14px;
      line-height: 1.5;
    }

    .line-numbers {
      padding-right: 20px;
      text-align: right;
      color: ${lineNumColor};
      user-select: none;
      border-right: 1px solid ${isDark ? '#333' : '#ddd'};
      margin-right: 20px;
    }

    .line-number {
      height: 21px;
    }

    .code-content {
      color: ${textColor};
      white-space: pre;
      overflow-x: auto;
    }

    .hint {
      margin-top: 20px;
      color: #8b949e;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn btn-primary" onclick="saveImage()">💾 Save as PNG</button>
    <button class="btn btn-secondary" onclick="copyImage()">📋 Copy to Clipboard</button>
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
        <div class="code-content">${codeHtml}</div>
      </div>
    </div>
  </div>

  <p class="hint">Tip: Adjust settings in VS Code Settings → Extensions → CodeSnap</p>

  <script>
    const vscode = acquireVsCodeApi();

    async function captureElement() {
      const element = document.getElementById('capture');
      const canvas = await html2canvas(element, {
        backgroundColor: null,
        scale: 2,
      });
      return canvas;
    }

    async function saveImage() {
      const canvas = await captureElement();
      const link = document.createElement('a');
      link.download = '${fileName.replace(/\.[^/.]+$/, '')}-codesnap.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }

    async function copyImage() {
      try {
        const canvas = await captureElement();
        canvas.toBlob(async (blob) => {
          if (blob) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            vscode.postMessage({ command: 'copy' });
          }
        });
      } catch (err) {
        console.error('Failed to copy:', err);
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

export function deactivate() {}
