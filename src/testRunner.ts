import * as child_process from 'child_process';
import * as async_mutex from 'async-mutex';
import * as tree_kill from 'tree-kill';
import * as path from 'path';
import * as vscode from 'vscode';

export class TestRunner {
	private readonly testFailLineNrRegex = ':([0-9]+):';
	private readonly testResultString = '(PASS|FAIL:\ ?(.*))';

	private _debugTestExecutable: string = "";
	private buildProcess: child_process.ChildProcess | undefined;
	private suiteProcess: child_process.ChildProcess | undefined;
	private buildMutex: async_mutex.Mutex = new async_mutex.Mutex();
	private suiteMutex: async_mutex.Mutex = new async_mutex.Mutex();

	public get preBuildCommand(): string {
		return this._preBuildCommand;
	}
	public set preBuildCommand(value: string) {
		this._preBuildCommand = value;
	}
	public get testBuildApplication(): string {
		return this._testBuildApplication;
	}
	public set testBuildApplication(value: string) {
		this._testBuildApplication = value;
	}
	public get testBuildCwdPath(): string {
		return this._testBuildCwdPath;
	}
	public set testBuildCwdPath(value: string) {
		this._testBuildCwdPath = value;
	}
	public get testBuildArgs(): string {
		return this._testBuildArgs;
	}
	public set testBuildArgs(value: string) {
		this._testBuildArgs = value;
	}
	public get testBuildTargetRegex(): string {
		return this._testBuildTargetRegex;
	}
	public set testBuildTargetRegex(value: string) {
		this._testBuildTargetRegex = value;
	}
	public get testExecutableRegex(): string {
		return this._testExecutableRegex;
	}
	public set testExecutableRegex(value: string) {
		this._testExecutableRegex = value;
	}
	public get testExecutableArgs(): string {
		return this._testExecutableArgs;
	}
	public set testExecutableArgs(value: string) {
		this._testExecutableArgs = value;
	}
	public get testExecutableArgNameFilterRegex(): string {
		return this._testExecutableArgNameFilterRegex;
	}
	public set testExecutableArgNameFilterRegex(value: string) {
		this._testExecutableArgNameFilterRegex = value;
	}
	public get debugConfiguration(): string {
		return this._debugConfiguration;
	}
	public set debugConfiguration(value: string) {
		this._debugConfiguration = value;
	}
	public get debugTestExecutable(): string {
		return this._debugTestExecutable;
	}

	constructor(private _workspacePath: string, private _preBuildCommand: string, private _testBuildApplication: string, private _testBuildCwdPath: string, private _testBuildArgs: string, private _testBuildTargetRegex: string, private _testExecutableRegex: string, private _testExecutableArgs: string, private _testExecutableArgNameFilterRegex: string, private _debugConfiguration: string) {

	}

	async runTests(
		controller: vscode.TestController,
		request: vscode.TestRunRequest,
	): Promise<void> {
		const run = controller.createTestRun(request);

		if (request.include) {
			await Promise.all(request.include.map(t => this.runNode(t, request, run)));
		} else {
			await Promise.all(mapTestItems(controller.items, t => this.runNode(t, request, run)));
		}

		run.end();
	}

	async runNode(
		node: vscode.TestItem,
		request: vscode.TestRunRequest,
		run: vscode.TestRun
	) {
		let testCasePassed: boolean;

		// Users can hide or filter out tests from their run. If the request says
		// they've done that for this node, then don't run it.
		if (request.exclude?.includes(node)) {
			return;
		}

		run.started(node);

		if (node.uri === undefined) {
			run.errored(node, new vscode.TestMessage('Cannot find test executable.'));
			return;
		}

		let testFileResult = await this.buildTest(node);

		if (testFileResult.error) {
			run.errored(node, new vscode.TestMessage('Cannot build test executable.'));
			return;
		}

		if (this._preBuildCommand !== '') {
			let result = await this.runCommand(this._preBuildCommand);
			if (result.error) {
				vscode.window.showErrorMessage('Cannot run pre-build command.');
				return;
			}
		}

		if (node.children.size > 0) {
			// Test has children, so it's a file that was requested to be run. Run it only once.
			testFileResult = await this.runEntireTestFile(node);
		}
		else {
			// Only a single test case requested
			testFileResult = await this.runSingleTestCase(node);
		}

		if (testFileResult.error) {
			run.errored(node, new vscode.TestMessage('Cannot run test executable.'));
			return;
		}

		if (node.children.size > 0) {
			let testFilePassed = true;
			// Test has children, so it's a file that was requested to be run. Mark all test results inside it accordingly.
			for (const testCase of node.children) {
				testCasePassed = this.checkTestCaseResult(testCase[1], testFileResult.stdout, run);

				if (!testCasePassed) {
					// Consider entire file failed if only one test case inside failed
					run.failed(node, new vscode.TestMessage(testFileResult));
					testFilePassed = false;
				}
			}

			if (testFilePassed === true) {
				run.passed(node);
			}
		}
		else {
			// Only a single test case requested
			this.checkTestCaseResult(node, testFileResult.stdout, run);
		}
	}

	checkTestCaseResult(
		node: vscode.TestItem,
		suiteResult: string,
		run: vscode.TestRun
	): boolean {
		let testCaseRegex = new RegExp(node.id + '\\) ' + this.testResultString);
		let match = testCaseRegex.exec(suiteResult);
		let testPassed = false;

		if (match !== null) {
			if (match[1] === 'PASS') {
				testPassed = true;
				run.passed(node);
			} else {
				let testFailRegex = new RegExp(this.testFailLineNrRegex + '.*' + node.id + '.*' + this.testResultString);
				match = testFailRegex.exec(suiteResult);

				if (match !== null) {
					//Regular Unity format
					run.failed(node, new vscode.TestMessage(match[3]));
					// testStatesEmitter.fire(<TestEvent>{
					// 	type: 'test',
					// 	test: node.id,
					// 	state: 'failed',
					// 	decorations: [{
					// 		line: parseInt(match[1]) - 1,
					// 		message: match[3]
					// 	}]
					// });
				}
				else {
					testFailRegex = new RegExp(node.id + '.*' + this.testFailLineNrRegex + '.*' + this.testResultString);
					match = testFailRegex.exec(suiteResult);

					if (match !== null) {
						//Unity Fixture format
						run.failed(node, new vscode.TestMessage(match[3]));
						// testStatesEmitter.fire(<TestEvent>{
						// 	type: 'test',
						// 	test: node.id,
						// 	state: 'failed',
						// 	decorations: [{
						// 		line: parseInt(match[1]) - 1,
						// 		message: match[3]
						// 	}]
						// });
					}
				}
			}
		}

		return testPassed;
	}

	async runCommand(command: string): Promise<any> {
		const release = await this.suiteMutex.acquire();
		try {
			return new Promise<any>((resolve) => {
				this.suiteProcess = child_process.exec(
					command,
					{
						cwd: this._workspacePath,
					},
					(error, stdout, stderr) => {
						resolve({ error, stdout, stderr });
					},
				);
			});
		} catch {

		}
		finally {
			release();
		}
	}

	private async runBuildCommand(buildArgs: string): Promise<any> {
		const release = await this.buildMutex.acquire();
		try {
			return new Promise<any>((resolve) => {
				this.buildProcess = child_process.exec(
					this._testBuildApplication + ' ' + buildArgs,
					{
						cwd: this._testBuildCwdPath
					},
					(error, stdout, stderr) => {
						resolve({ error, stdout, stderr });
					},
				);
			});
		} finally {
			release();
		}
	}

	// findSuite(searchNode: TestSuiteInfo, id: string): TestSuiteInfo | undefined {
	// 	if (searchNode.type === 'suite') {
	// 		for (const child of searchNode.children) {
	// 			if (child.id === id) {
	// 				if (child.type === 'suite') return child;
	// 				else return searchNode;
	// 			} else if (child.type === 'suite') {
	// 				const found = this.findSuite(child, id);
	// 				if (found) return found;
	// 			}
	// 		}
	// 	}
	// 	return undefined;
	// }

	// findNode(searchNode: TestSuiteInfo | TestInfo, id: string): TestSuiteInfo | TestInfo | undefined {
	// 	if (searchNode.id === id) {
	// 		return searchNode;
	// 	} else if (searchNode.type === 'suite') {
	// 		for (const child of searchNode.children) {
	// 			const found = this.findNode(child, id);
	// 			if (found) return found;
	// 		}
	// 	}
	// 	return undefined;
	// }

	private async buildTest(node: vscode.TestItem): Promise<any> {
		if (node.uri !== undefined) {
			let target = path.parse(node.uri.fsPath).name.replace(new RegExp('(.*)'), this._testBuildTargetRegex);

			return await this.runBuildCommand(this._testBuildArgs + ' ' + target);
		}
	}

	private async runEntireTestFile(node: vscode.TestItem): Promise<any> {
		if (node.uri !== undefined) {
			let exePath = '\"' + path.parse(node.uri.fsPath).name.replace(new RegExp('(.*)'), this._testExecutableRegex) + '\"';

			return await this.runCommand(exePath + ' ' + this._testExecutableArgs);
		}
	}

	private async runSingleTestCase(node: vscode.TestItem): Promise<any> {
		if (node.uri !== undefined) {
			let exePath = '\"' + path.parse(node.uri.fsPath).name.replace(new RegExp('(.*)'), this._testExecutableRegex) + '\"';
			let testcaseArg = this._testExecutableArgs;

			if (node.id.match(',')) {
				//Unity Fixture format
				testcaseArg += ' -g ' + node.id.split(new RegExp(', +'))[0] + ' -n ' + node.id.split(new RegExp(', +'))[1];
			}
			else {
				//Regular Unity format
				testcaseArg += ' -n ' + node.id;
			}

			return await this.runCommand(exePath + ' ' + this._testExecutableArgs);
		}
	}

	// async debug(suite: TestSuiteInfo,
	// 	workspace: vscode.WorkspaceFolder,
	// 	outputChannel: vscode.OutputChannel): Promise<void> {
	// 	try {
	// 		//Get and validate debug configuration
	// 		const debugConfiguration = this._debugConfiguration;
	// 		if (!debugConfiguration) {
	// 			vscode.window.showErrorMessage("No debug configuration specified. In Settings, set unityExplorer.debugConfiguration.");
	// 			return;
	// 		}

	// 		//Build test suite
	// 		if (suite !== undefined && suite.type === 'suite') {
	// 			let result = await this.buildTest(suite);
	// 			outputChannel.append(result.stdout);
	// 			outputChannel.append(result.stderr);
	// 			if (result.error) {
	// 				vscode.window.showErrorMessage('Cannot build test executable.');
	// 				return;
	// 			}
	// 		}

	// 		// Get test executable file name without extension
	// 		if (suite != undefined && suite.file != undefined) {
	// 			this._debugTestExecutable = path.parse(suite.file).name.replace(new RegExp('(.*)'), this.testExecutableRegex);

	// 			// Launch debugger
	// 			if (!await vscode.debug.startDebugging(workspace, debugConfiguration))
	// 				vscode.window.showErrorMessage('Debugger could not be started.');
	// 		}
	// 	}
	// 	finally {
	// 		// Reset current test executable
	// 		this._debugTestExecutable = "";
	// 	}
	// }

	cancel(): void {
		if (this.buildProcess !== undefined) {
			if (this.buildProcess.pid !== undefined) {
				tree_kill(this.buildProcess.pid);
			}
		}
		if (this.suiteProcess !== undefined) {
			if (this.suiteProcess.pid !== undefined) {
				tree_kill(this.suiteProcess.pid);
			}
		}
	}
}

// Small helper that works like "array.map" for children of a test collection
const mapTestItems = <T>(items: vscode.TestItemCollection, mapper: (t: vscode.TestItem) => T): T[] => {
	const result: T[] = [];
	items.forEach(t => result.push(mapper(t)));
	return result;
};
