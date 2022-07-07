import * as vscode from 'vscode';
import * as Path from 'path';
import * as fs from 'fs';
import { TestHub, testExplorerExtensionId } from 'vscode-test-adapter-api';
import { TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { UnityAdapter, getDebugTestExecutable, getDebugTestExecutableArgs } from './adapter';

function getCurrentDebugExec(): string {
    const currentExec = getDebugTestExecutable();
    if (!currentExec) {
        vscode.window.showErrorMessage("Not currently debugging a Unity Test");
        return "";
    }
    return currentExec;
}

function getCurrentDebugExecArgs(): string {
    const currentExecArgs = getDebugTestExecutableArgs();
    if (!currentExecArgs) {
        vscode.window.showErrorMessage("Not currently debugging a Unity Test");
        return "";
    }
    return currentExecArgs;
}

export async function activate(context: vscode.ExtensionContext) {
    var manifestPath = Path.join(context.extensionPath, "package.json");
    var packageFile = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (packageFile) {
        var outputChannel = vscode.window.createOutputChannel(packageFile.displayName);
    }

    const testExplorerExtension = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);
    if (testExplorerExtension) {
        context.subscriptions.push(vscode.commands.registerCommand("unityExplorer.debugTestExecutable", getCurrentDebugExec));
        context.subscriptions.push(vscode.commands.registerCommand("unityExplorer.debugTestExecutableArgs", getCurrentDebugExecArgs));
        context.subscriptions.push(new TestAdapterRegistrar(
            testExplorerExtension.exports,
            workspaceFolder => new UnityAdapter(workspaceFolder, outputChannel)
        ));
    }
}
