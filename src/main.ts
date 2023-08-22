import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationProvider } from './configurationProvider';
import { TestLoader } from './testLoader';
import { TestRunner } from './testRunner';

let testLoader: TestLoader;
let testRunner: TestRunner;

function getCurrentDebugConfiguration(): string {
	const currentExec = testRunner.debugTestExecutable;
	if (!currentExec) {
		vscode.window.showErrorMessage("Not currently debugging a Unity Test");
		return "";
	}
	return currentExec;
}

export function watchChanges() {
	vscode.workspace.onDidChangeConfiguration(event => {
		if (vscode.workspace.workspaceFolders !== undefined) {
			if (event.affectsConfiguration('unityExplorer.preBuildCommand')) {
				testRunner.preBuildCommand = ConfigurationProvider.getString('preBuildCommand');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildApplication')) {
				testRunner.testBuildApplication = ConfigurationProvider.getString('testBuildApplication');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildCwdPath')) {
				testRunner.testBuildCwdPath = ConfigurationProvider.getPath('testBuildCwdPath');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildArgs')) {
				testRunner.testBuildArgs = ConfigurationProvider.getString('testBuildArgs');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildTargetRegex')) {
				testRunner.testBuildTargetRegex = ConfigurationProvider.getString('testBuildTargetRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableRegex')) {
				testRunner.testExecutableRegex = ConfigurationProvider.getString('testExecutableRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableArgs')) {
				testRunner.testExecutableArgs = ConfigurationProvider.getString('testExecutableArgs');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableArgNameFilterRegex')) {
				testRunner.testExecutableArgNameFilterRegex = ConfigurationProvider.getString('testExecutableArgNameFilterRegex');
			}

		}
	});
}
export async function activate(context: vscode.ExtensionContext) {
	const controller = vscode.tests.createTestController('unity-test-adapter', 'Unity Test Controller');

	if (vscode.workspace.workspaceFolders !== undefined) {
		var workspace = vscode.workspace.workspaceFolders[0];

		testLoader = new TestLoader(controller);
		testRunner = new TestRunner(workspace.uri.fsPath, ConfigurationProvider.getString('preBuildCommand'), ConfigurationProvider.getString('testBuildApplication'), ConfigurationProvider.getPath('testBuildCwdPath'), ConfigurationProvider.getString('testBuildArgs'), ConfigurationProvider.getString('testBuildTargetRegex'), ConfigurationProvider.getString('testExecutableRegex'), ConfigurationProvider.getString('testExecutableArgs'), ConfigurationProvider.getString('testExecutableArgNameFilterRegex'), ConfigurationProvider.getString('debugConfiguration'));

		context.subscriptions.push(controller);
		context.subscriptions.push(vscode.commands.registerCommand("unityExplorer.debugTestExecutable", getCurrentDebugConfiguration));
		controller.resolveHandler = async test => {
			if (!test) {
				await testLoader.loadAllTests(controller);
			} else {
				await testLoader.parseTestsInFileContents(controller, test);
			}
		};

		controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, request => testRunner.runTests(controller, false, request, testLoader.parseTestsInFileContents), true);
		controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, request => testRunner.runTests(controller, true, request, testLoader.parseTestsInFileContents), true);
	}
}
