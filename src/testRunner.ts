import * as childProcess from 'child_process';
import * as asyncMutex from 'async-mutex';
import * as treeKill from 'tree-kill';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationProvider } from './configurationProvider';

export class TestRunner {
	private readonly testFailLineNrRegex = ':([0-9]+):';
	private readonly testResultString = '(.*):*(PASS|FAIL:\ ?(.*)|IGNORE(:.*)?)';

	private _debugTestExecutable: string = '';
	private buildProcess: childProcess.ChildProcess | undefined;
	private suiteProcess: childProcess.ChildProcess | undefined;
	private buildMutex: asyncMutex.Mutex = new asyncMutex.Mutex();
	private suiteMutex: asyncMutex.Mutex = new asyncMutex.Mutex();

	public get debugTestExecutable(): string {
		if (!this._debugTestExecutable) {
			vscode.window.showErrorMessage("Not currently debugging a Unity Test");
			return "";
		}
		return this._debugTestExecutable;
	}

	constructor() { }

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

				if (runResult) {
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
		}

		run.end();
	}

	async runNode(
		node: vscode.TestItem,
		run: vscode.TestRun
	): Promise<any> {
		if (node.uri === undefined) {
			run.appendOutput('Test error. See test run details for more info.');
			run.errored(node, new vscode.TestMessage('Cannot find test executable.'));
			return;
		}

		let runResult = await this.buildTest(node);

		if (run.token.isCancellationRequested) {
			return;
		}
		else if (runResult.error) {
			run.appendOutput('Test error. See test run details for more info.');
			run.errored(node, new vscode.TestMessage('Cannot build test executable.'));
			run.errored(node, new vscode.TestMessage(runResult.stderr));
			return;
		}

		let preBuildCommand = ConfigurationProvider.getString('preBuildCommand', node.uri);

		if (preBuildCommand !== '') {
			let result = await this.runCommand(ConfigurationProvider.getWorkspace(node.uri), preBuildCommand);
			if (result.error) {
				run.appendOutput('Test error. See test run details for more info.');
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

		if (runResult.error && runResult.error.signal) {
			run.appendOutput('Test error. See test run details for more info.');
			run.errored(node, new vscode.TestMessage('Cannot run test executable.'));
			run.errored(node, new vscode.TestMessage(runResult.error.stack));
			return;
		}

		return runResult;
	}

	async debugNode(
		node: vscode.TestItem,
		run: vscode.TestRun
	): Promise<any> {
		let debugConfiguration = ConfigurationProvider.getString('debugConfiguration', node.uri);

		if (debugConfiguration === undefined) {
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

		let preBuildCommand = ConfigurationProvider.getString('preBuildCommand', node.uri);

		if (preBuildCommand !== '') {
			let result = await this.runCommand(ConfigurationProvider.getWorkspace(node.uri), preBuildCommand);
			if (result.error) {
				vscode.window.showErrorMessage('Cannot run pre-build command.');
				return;
			}
		}

		if (run.token.isCancellationRequested) {
			return;
		}
		else {
			let testExecutableRegex = ConfigurationProvider.getString('testExecutableRegex', node.uri);
			this._debugTestExecutable = path.parse(node.uri.fsPath).name.replace(new RegExp('(.*)'), testExecutableRegex);
			if (!await vscode.debug.startDebugging(ConfigurationProvider.getWorkspace(node.uri), debugConfiguration)) {
				vscode.window.showErrorMessage('Debugger could not be started.');
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
					testFilePassed = false;
				}
			}

			if (testFilePassed === true) {
				run.appendOutput('Test passed.');
				run.passed(node);
			}
			else {
				run.failed(node, new vscode.TestMessage(runResult));
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
		let testCaseRegex = new RegExp(node.id + this.testResultString);
		let match = testCaseRegex.exec(runResult);
		let testPassed = false;

		if (match !== null) {
			if (match[2] === 'PASS') {
				testPassed = true;
				run.passed(node);
			} else if (match[2].startsWith('IGNORE')) {
				testPassed = true;
				run.skipped(node);
				node.description = match[2];
			} else {
				let testFailRegex = new RegExp(this.testFailLineNrRegex + '.*' + node.id + '.*' + this.testResultString);
				match = testFailRegex.exec(runResult);

				if (match !== null) {
					//Regular Unity format
					run.failed(node, new vscode.TestMessage(match[4]));
				}
				else {
					testFailRegex = new RegExp(node.id + '.*' + this.testFailLineNrRegex + '.*' + this.testResultString);
					match = testFailRegex.exec(runResult);

					if (match !== null) {
						//Unity Fixture format
						let line = +match[1] - 1;
						let testRange = node.range;
						node.range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
						run.failed(node, new vscode.TestMessage(match[4]));
						node.range = testRange;
					}
				}
			}
		}

		return testPassed;
	}

	async runCommand(workspace: vscode.WorkspaceFolder | undefined, command: string): Promise<any> {
		const release = await this.suiteMutex.acquire();
		try {
			return new Promise<any>((resolve) => {
				this.suiteProcess = childProcess.exec(
					command,
					{
						cwd: workspace?.uri.fsPath,
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

	private async runBuildCommand(workspace: vscode.WorkspaceFolder | undefined, buildArgs: string): Promise<any> {
		const release = await this.buildMutex.acquire();
		try {
			return new Promise<any>((resolve) => {
				let testBuildApplication = ConfigurationProvider.getString('testBuildApplication', workspace?.uri);
				this.buildProcess = childProcess.exec(
					testBuildApplication + ' ' + buildArgs,
					{
						cwd: workspace?.uri.fsPath,
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
			let testBuildTargetRegex = ConfigurationProvider.getString('testBuildTargetRegex', node.uri);
			let testBuildArgs = ConfigurationProvider.getString('testBuildArgs', node.uri);
			let target = path.parse(node.uri.fsPath).name.replace(new RegExp('(.*)'), testBuildTargetRegex);

			return await this.runBuildCommand(ConfigurationProvider.getWorkspace(node.uri), testBuildArgs + ' ' + target);
		}
	}

	private async runEntireTestFile(node: vscode.TestItem): Promise<any> {
		if (node.uri !== undefined) {
			let testExecutableRegex = ConfigurationProvider.getString('testExecutableRegex', node.uri);
			let testExecutableArgs = ConfigurationProvider.getString('testExecutableArgs', node.uri);
			let exePath = '\"' + path.parse(node.uri.fsPath).name.replace(new RegExp('(.*)'), testExecutableRegex) + '\"';

			return await this.runCommand(ConfigurationProvider.getWorkspace(node.uri), exePath + ' ' + testExecutableArgs);
		}
	}

	private async runSingleTestCase(node: vscode.TestItem): Promise<any> {
		if (node.uri !== undefined) {
			let testExecutableRegex = ConfigurationProvider.getString('testExecutableRegex', node.uri);
			let testExecutableArgs = ConfigurationProvider.getString('testExecutableArgs', node.uri);
			let exePath = '\"' + path.parse(node.uri.fsPath).name.replace(new RegExp('(.*)'), testExecutableRegex) + '\"';
			let testcaseArg = testExecutableArgs;

			if (node.id.match(',')) {
				//Unity Fixture format
				testcaseArg += ' -g ' + node.id.split(new RegExp(', +'))[0] + ' -n ' + node.id.split(new RegExp(', +'))[1];
			}
			else {
				//Regular Unity format
				testcaseArg += ' -n ' + node.id;
			}

			return await this.runCommand(ConfigurationProvider.getWorkspace(node.uri), exePath + ' ' + testExecutableArgs);
		}
	}

	cancel(): void {
		if (this.buildProcess !== undefined) {
			if (this.buildProcess.pid !== undefined) {
				treeKill(this.buildProcess.pid);
			}
		}
		if (this.suiteProcess !== undefined) {
			if (this.suiteProcess.pid !== undefined) {
				treeKill(this.suiteProcess.pid);
			}
		}
	}
}
