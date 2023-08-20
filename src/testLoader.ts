import * as fs from 'fs';
import * as path from 'path';
import {
	TestSuiteInfo,
	TestInfo,
} from 'vscode-test-adapter-api';

export class TestLoader {
	public get prettyTestCaseRegex(): string {
		return this._prettyTestCaseRegex;
	}
	public set prettyTestCaseRegex(value: string) {
		this._prettyTestCaseRegex = value;
	}
	public get prettyTestFileRegex(): string {
		return this._prettyTestFileRegex;
	}
	public set prettyTestFileRegex(value: string) {
		this._prettyTestFileRegex = value;
	}
	public get testCaseRegex(): string {
		return this._testCaseRegex;
	}
	public set testCaseRegex(value: string) {
		this._testCaseRegex = value;
	}

	constructor(private _prettyTestCaseRegex: string, private _prettyTestFileRegex: string, private _testCaseRegex: string) {

	}

	async loadTests(workspacePath: string, files: string[]): Promise<TestSuiteInfo> {
		let localTestSuiteInfo = {
			type: 'suite',
			id: 'root',
			label: 'Unity',
			children: []
		} as TestSuiteInfo;

		for (const file of files) {
			const fileLabel = this.setFileLabel(workspacePath, file);
			const currentTestSuiteInfo: TestSuiteInfo = {
				type: 'suite',
				id: file,
				label: fileLabel,
				file: file,
				children: []
			};
			const testRegex = new RegExp(this._testCaseRegex, 'gm');
			const fileText = await fs.promises.readFile(file, 'utf8');
			let match = testRegex.exec(fileText);
			while (match != null) {
				let testName = match[1];
				const testLabel = this.setTestLabel(testName);
				let line = fileText.substr(0, match.index).split('\n').length - 1;
				line = line + match[0].substr(0, match[0].search(/\S/g)).split('\n').length - 1;
				currentTestSuiteInfo.children.push({
					type: 'test',
					id: file + '::' + testName,
					label: testLabel,
					file: file,
					line: line
				} as TestInfo)
				match = testRegex.exec(fileText);
			}
			localTestSuiteInfo.children.push(currentTestSuiteInfo);
		}

		return localTestSuiteInfo;
	}

	private setTestLabel(testName: string): string | undefined {
		let testLabel = testName;
		if (this._prettyTestCaseRegex != '') {
			const labeltestLabelRegex = new RegExp(this._prettyTestCaseRegex);
			let testLabelMatches = labeltestLabelRegex.exec(testName);
			if (testLabelMatches != null) {
				testLabel = testLabelMatches[1];
			}
		}
		return testLabel;
	}

	private setFileLabel(workspacePath: string, fileName: string): string {
		let fileLabel = path.relative(workspacePath, fileName);
		if (this._prettyTestFileRegex != '') {
			const labelFileRegex = new RegExp(this._prettyTestFileRegex);
			let labelMatches = labelFileRegex.exec(fileName);
			if (labelMatches != null) {
				fileLabel = labelMatches[1];
			}
		}
		return fileLabel;
	}
}
