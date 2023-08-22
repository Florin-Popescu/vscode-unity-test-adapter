import * as vscode from 'vscode';
import { TestLoader } from './testLoader';
import { TestRunner } from './testRunner';

let testLoader: TestLoader;
let testRunner: TestRunner;

export async function activate(context: vscode.ExtensionContext) {
	const controller = vscode.tests.createTestController('unity-test-adapter', 'Unity Test Controller');

	if (vscode.workspace.workspaceFolders !== undefined) {
		testLoader = new TestLoader(controller);
		testRunner = new TestRunner();

		context.subscriptions.push(controller);
		context.subscriptions.push(vscode.commands.registerCommand("unityExplorer.debugTestExecutable", () => { return testRunner.debugTestExecutable; }));

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
