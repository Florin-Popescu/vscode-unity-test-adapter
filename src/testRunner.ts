import * as child_process from 'child_process';
import * as async_mutex from 'async-mutex';
import * as tree_kill from 'tree-kill';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	TestRunStartedEvent,
	TestRunFinishedEvent,
	TestSuiteEvent,
	TestEvent,
	TestSuiteInfo,
	TestInfo
} from 'vscode-test-adapter-api';

export class TestRunner {
	private readonly testFailLineNrRegex = ':([0-9]+):';
	private readonly testResultString = '(PASS|FAIL:\ ?(.*))';

	private _debugTestExecutable: string = "";
	private buildProcess: child_process.ChildProcess | undefined;
	private suiteProcess: child_process.ChildProcess | undefined;
	private buildMutex: async_mutex.Mutex = new async_mutex.Mutex();
	private suiteMutex: async_mutex.Mutex = new async_mutex.Mutex();

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
	public get testExecutableArgSingleCaseRegex(): string {
		return this._testExecutableArgSingleCaseRegex;
	}
	public set testExecutableArgSingleCaseRegex(value: string) {
		this._testExecutableArgSingleCaseRegex = value;
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

	constructor(private _testBuildApplication: string, private _testBuildCwdPath: string, private _testBuildArgs: string, private _testBuildTargetRegex: string, private _testExecutableRegex: string, private _testExecutableArgs: string, private _testExecutableArgSingleCaseRegex: string, private _debugConfiguration: string) {

	}

	async runSuites(
		testSuiteInfo: TestSuiteInfo,
		tests: string[],
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>,
		workingDirectory: string,
		outputChannel: vscode.OutputChannel
	): Promise<void> {
		for (const suiteOrTestId of tests) {
			//Find containing suite
			const suite = this.findSuite(testSuiteInfo, suiteOrTestId);
			if (suite !== undefined && suite.type === 'suite') {
				let result = await this.runSuiteExe(suite, testStatesEmitter, workingDirectory, outputChannel);

				if (suiteOrTestId == suite.id) {
					if (result.error && !result.stdout) {
						for (const child of suite.children) {
							testStatesEmitter.fire(<TestEvent>{ type: 'test', test: child.id, state: 'failed' });
						}
						if (result.stderr.search('The process cannot access the file because it is being used by another process')) {
							vscode.window.showErrorMessage('Cannot run test executable for ' + suiteOrTestId + '.');
						}
					} else {
						for (const child of suite.children) {
							if (child.type === 'test') {
								await this.checkTestResult(child, result.stdout, testStatesEmitter);
							}
						}
					}
				} else {
					if (result.error && !result.stdout) {
						for (const child of suite.children) {
							testStatesEmitter.fire(<TestEvent>{ type: 'test', test: child.id, state: 'failed' });
						}
						vscode.window.showErrorMessage('Cannot run test executable for ' + suiteOrTestId + '.');
					} else {
						const node = this.findNode(testSuiteInfo, suiteOrTestId);
						if (node !== undefined && node.type === 'test') {
							await this.checkTestResult(node, result.stdout, testStatesEmitter);
						}
					}
				}
			}
		}
	}

	async runSuiteExe(
		node: TestSuiteInfo,
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>,
		workingDirectory: string,
		outputChannel: vscode.OutputChannel
	): Promise<any> {
		testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'running' });

		let result = await this.buildTest(node);
		outputChannel.append(result.stdout);
		outputChannel.append(result.stderr);
		if (result.error) {
			vscode.window.showErrorMessage('Cannot build test executable.');
		} else {
			result = await this.runTest(node, workingDirectory);
			outputChannel.append(result.stdout);
			outputChannel.append(result.stderr);
		}

		testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'completed' });

		return result;
	}

	async checkTestResult(
		node: TestInfo,
		suiteResult: string,
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
	): Promise<void> {
		testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'running' });

		let testCaseRegex = new RegExp(node.label + '.*' + this.testResultString);
		let match = testCaseRegex.exec(suiteResult);

		if (match != null) {
			if (match[1] === 'PASS') {
				testStatesEmitter.fire(<TestEvent>{
					type: 'test',
					test: node.id,
					state: 'passed'
				});
			} else {
				let testFailRegex = new RegExp(this.testFailLineNrRegex + '.*' + node.label + '.*' + this.testResultString);
				match = testFailRegex.exec(suiteResult);

				if (match != null) {
					//Regular Unity format
					testStatesEmitter.fire(<TestEvent>{
						type: 'test',
						test: node.id,
						state: 'failed',
						decorations: [{
							line: parseInt(match[1]) - 1,
							message: match[3]
						}]
					});
				}
				else {
					testFailRegex = new RegExp(node.label + '.*' + this.testFailLineNrRegex + '.*' + this.testResultString);
					match = testFailRegex.exec(suiteResult);

					if (match != null) {
						//Unity Fixture format
						testStatesEmitter.fire(<TestEvent>{
							type: 'test',
							test: node.id,
							state: 'failed',
							decorations: [{
								line: parseInt(match[1]) - 1,
								message: match[3]
							}]
						});
					}
				}
			}
		}
	}

	async runCommand(workingDirectory: string, command: string): Promise<any> {
		const release = await this.suiteMutex.acquire();
		try {
			return new Promise<any>((resolve) => {
				this.suiteProcess = child_process.exec(
					command,
					{
						cwd: workingDirectory,
					},
					(error, stdout, stderr) => {
						resolve({ error, stdout, stderr });
					},
				)
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
				)
			});
		} finally {
			release();
		}
	}

	findSuite(searchNode: TestSuiteInfo, id: string): TestSuiteInfo | undefined {
		if (searchNode.type === 'suite') {
			for (const child of searchNode.children) {
				if (child.id === id) {
					if (child.type === 'suite') return child;
					else return searchNode;
				} else if (child.type === 'suite') {
					const found = this.findSuite(child, id);
					if (found) return found;
				}
			}
		}
		return undefined;
	}

	findNode(searchNode: TestSuiteInfo | TestInfo, id: string): TestSuiteInfo | TestInfo | undefined {
		if (searchNode.id === id) {
			return searchNode;
		} else if (searchNode.type === 'suite') {
			for (const child of searchNode.children) {
				const found = this.findNode(child, id);
				if (found) return found;
			}
		}
		return undefined;
	}

	async buildTest(node: TestSuiteInfo): Promise<any> {
		let buildArgs = this._testBuildArgs;

		if (node.file != undefined) {
			let target = path.parse(node.file).name.replace(new RegExp('(.*)'), this._testBuildTargetRegex);
			target = target.replace(/\\/g, '/');

			return await this.runBuildCommand(buildArgs + ' ' + target);
		}
	}

	private async runTest(node: TestSuiteInfo, workingDirectory: string): Promise<any> {
		if (node.file != undefined) {
			let exePath = '\"' + path.parse(node.file).name.replace(new RegExp('(.*)'), this._testExecutableRegex) + '\"';

			return await this.runCommand(workingDirectory, exePath + ' ' + this._testExecutableArgs);
		}
	}

	async debug(suite: TestSuiteInfo,
		workspace: vscode.WorkspaceFolder,
		outputChannel: vscode.OutputChannel): Promise<void> {
		try {
			//Get and validate debug configuration
			const debugConfiguration = this._debugConfiguration;
			if (!debugConfiguration) {
				vscode.window.showErrorMessage("No debug configuration specified. In Settings, set unityExplorer.debugConfiguration.");
				return;
			}

			//Build test suite
			if (suite !== undefined && suite.type === 'suite') {
				let result = await this.buildTest(suite);
				outputChannel.append(result.stdout);
				outputChannel.append(result.stderr);
				if (result.error) {
					vscode.window.showErrorMessage('Cannot build test executable.');
					return;
				}
			}

			// Get test executable file name without extension
			if (suite != undefined && suite.file != undefined) {
				this._debugTestExecutable = path.parse(suite.file).name.replace(new RegExp('(.*)'), this.testExecutableRegex);

				// Launch debugger
				if (!await vscode.debug.startDebugging(workspace, debugConfiguration))
					vscode.window.showErrorMessage('Debugger could not be started.');
			}
		}
		finally {
			// Reset current test executable
			this._debugTestExecutable = "";
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
