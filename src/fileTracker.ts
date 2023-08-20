import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class FileTracker {
	private readonly autorunEmitter = new vscode.EventEmitter<void>();

	watchedFileForAutorunList: string[] = [];
	watchedFileForReloadList: string[] = [];

	async getFileList(filePath: string, fileRegex: RegExp): Promise<string[]> {
		let filesAndFolders: string[] = [];
		let files: string[] = [];

		try {
			filesAndFolders = await fs.promises.readdir(filePath);
		} catch (err) {
			vscode.window.showErrorMessage('Cannot find test result path: ' + err);
			return [''];
		} finally {
			for (const item of filesAndFolders) {
				let fullPath = path.resolve(filePath, item);
				if ((await fs.promises.lstat(fullPath)).isFile()) {
					if (fileRegex.test(fullPath)) {
						files.push(fullPath);
					}
				}
				else {
					files = files.concat(await this.getFileList(fullPath, fileRegex));
				}
			}
		}

		return files;
	}

	watchFilesForAutorun(workspacePath: string, files: string[]): void {
		for (const file of files) {
			if (!this.watchedFileForAutorunList.includes(file)) {
				this.watchedFileForAutorunList.push(file);
				const fullPath = path.resolve(workspacePath, file);
				fs.watchFile(fullPath, () => {
					this.autorunEmitter.fire();
				});
			}
		}
	}

	watchFilesForReload(workspacePath: string, files: string[], listener: Function): void {
		for (const file of files) {
			if (!this.watchedFileForReloadList.includes(file)) {
				this.watchedFileForReloadList.push(file);
				const fullPath = path.resolve(workspacePath, file);
				fs.watchFile(fullPath, () => {
					listener();
				});
			}
		}
	}
}
