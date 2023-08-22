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
		if (!this._debugTestExecutable) {
			vscode.window.showErrorMessage("Not currently debugging a Unity Test");
			return "";
		}
		return this._debugTestExecutable;
	}

	constructor(private _workspacePath: string, private _preBuildCommand: string, private _testBuildApplication: string, private _testBuildCwdPath: string, private _testBuildArgs: string, private _testBuildTargetRegex: string, private _testExecutableRegex: string, private _testExecutableArgs: string, private _testExecutableArgNameFilterRegex: string, private _debugConfiguration: string) {

	}

	async runTests(
		controller: vscode.TestController,
		shouldDebug: boolean,
		request: vscode.TestRunRequest,
		parseTestsInFileContents: Function
	): Promise<void> {
		const run = controller.createTestRun(request);
		const queue: vscode.TestItem[] = [];

		// Loop through all included tests, or all known tests, and add them to our queue
		if (request.include) {
			request.include.forEach(test => queue.push(test));
		} else {
			controller.items.forEach(test => queue.push(test));
		}

		run.token.onCancellationRequested(() => {
			this.cancel();
		});

		// For every test that was queued, try to run it. Call run.passed() or run.failed().
		// The `TestMessage` can contain extra information, like a failing location or
		// a diff output. But here we'll just give it a textual message.
		while (queue.length > 0 && !run.token.isCancellationRequested) {
			const test = queue.pop()!;

			// Skip tests the user asked to exclude
			if (request.exclude?.includes(test)) {
				continue;
			}

			run.started(test);

			let runResult: any;

			if (shouldDebug) {
				runResult = await this.debugNode(test, run);
			}
			else {
				runResult = await this.runNode(test, run);

				if (run.token.isCancellationRequested) {
					run.skipped(test);
					continue;
				}

				if (test.canResolveChildren) {
					// If we're running a file and don't know what it contains yet, parse it now
					if (test.children.size === 0) {
						await parseTestsInFileContents(test);
					}
				}

				this.checkTestRunResult(test, runResult.stdout, run);
			}
		}

		run.end();
	}

	async runNode(
		node: vscode.TestItem,
		run: vscode.TestRun
	): Promise<any> {
		if (node.uri === undefined) {
			run.errored(node, new vscode.TestMessage('Cannot find test executable.'));
			return;
		}

		let runResult = await this.buildTest(node);

		if (run.token.isCancellationRequested) {
			return;
		}
		else if (runResult.error) {
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

		if (run.token.isCancellationRequested) {
			return;
		}
		else if (node.canResolveChildren) {
			// Test has children, so it's a file that was requested to be run. Run it only once.
			runResult = await this.runEntireTestFile(node);
		}
		else {
			// Only a single test case requested
			runResult = await this.runSingleTestCase(node);
		}

		if (runResult.error) {
			run.errored(node, new vscode.TestMessage('Cannot run test executable.'));
			return;
		}

		return runResult;
	}

	async debugNode(
		node: vscode.TestItem,
		run: vscode.TestRun
	): Promise<any> {
		if (this._debugConfiguration === undefined) {
			vscode.window.showErrorMessage("No debug configuration specified. In Settings, set unityExplorer.debugConfiguration.");
			return;
		}

		if (node.uri === undefined) {
			run.errored(node, new vscode.TestMessage('Cannot find test executable.'));
			return;
		}

		let runResult = await this.buildTest(node);

		if (run.token.isCancellationRequested) {
			return;
		}
		else if (runResult.error) {
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

		if (run.token.isCancellationRequested) {
			return;
		}
		else {
			if (vscode.workspace.workspaceFolders) {
				for (const workspaceFolder of vscode.workspace.workspaceFolders) {
					if (node.uri.toString().includes(workspaceFolder.uri.toString())) {
						this._debugTestExecutable = path.parse(node.uri.fsPath).name.replace(new RegExp('(.*)'), this.testExecutableRegex);
						if (!await vscode.debug.startDebugging(workspaceFolder, this.debugConfiguration)) {
							vscode.window.showErrorMessage('Debugger could not be started.');
						}
					}
				}
			}
		}

		if (runResult.error) {
			run.errored(node, new vscode.TestMessage('Cannot run test executable.'));
		}

		this._debugTestExecutable = "";
	}

	checkTestRunResult(
		node: vscode.TestItem,
		runResult: string,
		run: vscode.TestRun
	) {
		let testCasePassed: boolean;

		if (node.canResolveChildren) {
			let testFilePassed = true;
			// Test has children, so it's a file that was requested to be run. Mark all test results inside it accordingly.
			for (const testCase of node.children) {
				testCasePassed = this.checkTestCaseResult(testCase[1], runResult, run);

				if (!testCasePassed) {
					// Consider entire file failed if only one test case inside failed
					run.failed(node, new vscode.TestMessage(runResult));
					testFilePassed = false;
				}
			}

			if (testFilePassed === true) {
				run.passed(node);
			}
		}
		else {
			// Only a single test case requested
			this.checkTestCaseResult(node, runResult, run);
		}
	}

	checkTestCaseResult(
		node: vscode.TestItem,
		runResult: string,
		run: vscode.TestRun
	): boolean {
		let testCaseRegex = new RegExp(node.id + '\\) ' + this.testResultString);
		let match = testCaseRegex.exec(runResult);
		let testPassed = false;

		if (match !== null) {
			if (match[1] === 'PASS') {
				testPassed = true;
				run.passed(node);
			} else {
				let testFailRegex = new RegExp(this.testFailLineNrRegex + '.*' + node.id + '.*' + this.testResultString);
				match = testFailRegex.exec(runResult);

				if (match !== null) {
					//Regular Unity format
					run.failed(node, new vscode.TestMessage(match[3]));
				}
				else {
					testFailRegex = new RegExp(node.id + '.*' + this.testFailLineNrRegex + '.*' + this.testResultString);
					match = testFailRegex.exec(runResult);

					if (match !== null) {
						//Unity Fixture format
						run.failed(node, new vscode.TestMessage(match[3]));
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
