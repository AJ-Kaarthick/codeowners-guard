const Module = require('module');
const path = require('path');

const originalRequire = Module.prototype.require;
const mockVsCodePath = path.resolve(__dirname, 'mocks/vscode');

Module.prototype.require = function (request: string) {
  if (request === 'vscode') {
    return originalRequire.call(this, mockVsCodePath);
  }
  return originalRequire.apply(this, arguments as any);
};
