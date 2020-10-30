/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as should from 'should';
import * as path from 'path';
import * as sinon from 'sinon';
import * as baselines from './baselines/baselines';
import * as templates from '../templates/templates';
import * as testUtils from './testUtils';
import * as constants from '../common/constants';

import { promises as fs } from 'fs';
import { Project, EntryType, SystemDatabase, SystemDatabaseReferenceProjectEntry, SqlProjectReferenceProjectEntry } from '../models/project';
import { exists, convertSlashesForSqlProj } from '../common/utils';
import { Uri, window } from 'vscode';

let projFilePath: string;

describe('Project: sqlproj content operations', function (): void {
	before(async function (): Promise<void> {
		await baselines.loadBaselines();
	});

	beforeEach(async () => {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.openProjectFileBaseline);
	});

	it('Should read Project from sqlproj', async function (): Promise<void> {
		const project: Project = await Project.openProject(projFilePath);

		// Files and folders
		should(project.files.filter(f => f.type === EntryType.File).length).equal(6);
		should(project.files.filter(f => f.type === EntryType.Folder).length).equal(4);

		should(project.files.find(f => f.type === EntryType.Folder && f.relativePath === 'Views\\User')).not.equal(undefined); // mixed ItemGroup folder
		should(project.files.find(f => f.type === EntryType.File && f.relativePath === 'Views\\User\\Profile.sql')).not.equal(undefined); // mixed ItemGroup file
		should(project.files.find(f => f.type === EntryType.File && f.relativePath === '..\\Test\\Test.sql')).not.equal(undefined); // mixed ItemGroup file
		should(project.files.find(f => f.type === EntryType.File && f.relativePath === 'MyExternalStreamingJob.sql')).not.equal(undefined); // entry with custom attribute


		// SqlCmdVariables
		should(Object.keys(project.sqlCmdVariables).length).equal(2);
		should(project.sqlCmdVariables['ProdDatabaseName']).equal('MyProdDatabase');
		should(project.sqlCmdVariables['BackupDatabaseName']).equal('MyBackupDatabase');

		// Database references
		// should only have one database reference even though there are two master.dacpac references (1 for ADS and 1 for SSDT)
		should(project.databaseReferences.length).equal(1);
		should(project.databaseReferences[0].databaseName).containEql(constants.master);
		should(project.databaseReferences[0] instanceof SystemDatabaseReferenceProjectEntry).equal(true);

		// Pre-post deployment scripts
		should(project.preDeployScripts.length).equal(1);
		should(project.postDeployScripts.length).equal(1);
		should(project.noneDeployScripts.length).equal(2);
		should(project.preDeployScripts.find(f => f.type === EntryType.File && f.relativePath === 'Script.PreDeployment1.sql')).not.equal(undefined, 'File Script.PreDeployment1.sql not read');
		should(project.postDeployScripts.find(f => f.type === EntryType.File && f.relativePath === 'Script.PostDeployment1.sql')).not.equal(undefined, 'File Script.PostDeployment1.sql not read');
		should(project.noneDeployScripts.find(f => f.type === EntryType.File && f.relativePath === 'Script.PreDeployment2.sql')).not.equal(undefined, 'File Script.PostDeployment2.sql not read');
		should(project.noneDeployScripts.find(f => f.type === EntryType.File && f.relativePath === 'Tables\\Script.PostDeployment1.sql')).not.equal(undefined, 'File Tables\\Script.PostDeployment1.sql not read');
	});

	it('Should read Project with Project reference from sqlproj', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.openProjectWithProjectReferencesBaseline);
		const project: Project = await Project.openProject(projFilePath);

		// Database references
		// should only have two database references even though there are two master.dacpac references (1 for ADS and 1 for SSDT)
		should(project.databaseReferences.length).equal(2);
		should(project.databaseReferences[0].databaseName).containEql(constants.master);
		should(project.databaseReferences[0] instanceof SystemDatabaseReferenceProjectEntry).equal(true);
		should(project.databaseReferences[1].databaseName).containEql('TestProjectName');
		should(project.databaseReferences[1] instanceof SqlProjectReferenceProjectEntry).equal(true);
	});

	it('Should throw warning message while reading Project with more than 1 pre-deploy script from sqlproj', async function (): Promise<void> {
		const stub = sinon.stub(window, 'showWarningMessage').returns(<any>Promise.resolve(constants.okString));

		projFilePath = await testUtils.createTestSqlProjFile(baselines.openSqlProjectWithPrePostDeploymentError);
		const project: Project = await Project.openProject(projFilePath);

		should(stub.calledOnce).be.true('showWarningMessage should have been called exactly once');
		should(stub.calledWith(constants.prePostDeployCount)).be.true(`showWarningMessage not called with expected message '${constants.prePostDeployCount}' Actual '${stub.getCall(0).args[0]}'`);

		should(project.preDeployScripts.length).equal(2);
		should(project.postDeployScripts.length).equal(1);
		should(project.noneDeployScripts.length).equal(1);
		should(project.preDeployScripts.find(f => f.type === EntryType.File && f.relativePath === 'Script.PreDeployment1.sql')).not.equal(undefined, 'File Script.PreDeployment1.sql not read');
		should(project.postDeployScripts.find(f => f.type === EntryType.File && f.relativePath === 'Script.PostDeployment1.sql')).not.equal(undefined, 'File Script.PostDeployment1.sql not read');
		should(project.preDeployScripts.find(f => f.type === EntryType.File && f.relativePath === 'Script.PreDeployment2.sql')).not.equal(undefined, 'File Script.PostDeployment2.sql not read');
		should(project.noneDeployScripts.find(f => f.type === EntryType.File && f.relativePath === 'Tables\\Script.PostDeployment1.sql')).not.equal(undefined, 'File Tables\\Script.PostDeployment1.sql not read');
	});

	it('Should add Folder and Build entries to sqlproj', async function (): Promise<void> {
		const project = await Project.openProject(projFilePath);

		const folderPath = 'Stored Procedures';
		const scriptPath = path.join(folderPath, 'Fake Stored Proc.sql');
		const scriptContents = 'SELECT \'This is not actually a stored procedure.\'';

		const scriptPathTagged = path.join(folderPath, 'Fake External Streaming Job.sql');
		const scriptContentsTagged = 'EXEC sys.sp_create_streaming_job \'job\', \'SELECT 7\'';

		await project.addFolderItem(folderPath);
		await project.addScriptItem(scriptPath, scriptContents);
		await project.addScriptItem(scriptPathTagged, scriptContentsTagged, templates.externalStreamingJob);

		const newProject = await Project.openProject(projFilePath);

		should(newProject.files.find(f => f.type === EntryType.Folder && f.relativePath === convertSlashesForSqlProj(folderPath))).not.equal(undefined);
		should(newProject.files.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(scriptPath))).not.equal(undefined);
		should(newProject.files.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(scriptPathTagged))).not.equal(undefined);
		should(newProject.files.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(scriptPathTagged))?.sqlObjectType).equal(constants.ExternalStreamingJob);

		const newScriptContents = (await fs.readFile(path.join(newProject.projectFolderPath, scriptPath))).toString();

		should(newScriptContents).equal(scriptContents);
	});

	it('Should add Folder and Build entries to sqlproj with pre-existing scripts on disk', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		let list: string[] = await testUtils.createListOfFiles(path.dirname(projFilePath));

		await project.addToProject(list);

		should(project.files.filter(f => f.type === EntryType.File).length).equal(11);	// txt file shouldn't be added to the project
		should(project.files.filter(f => f.type === EntryType.Folder).length).equal(2);	// 2 folders
	});

	it('Should throw error while adding Folder and Build entries to sqlproj when a file/folder does not exist on disk', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		let list: string[] = [];
		let testFolderPath: string = await testUtils.createDummyFileStructure(true, list, path.dirname(projFilePath));

		const nonexistentFile = path.join(testFolderPath, 'nonexistentFile.sql');
		list.push(nonexistentFile);

		await testUtils.shouldThrowSpecificError(async () => await project.addToProject(list), `ENOENT: no such file or directory, stat \'${nonexistentFile}\'`);
	});

	it('Should choose correct master dacpac', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		let uri = project.getSystemDacpacUri(constants.masterDacpac);
		let ssdtUri = project.getSystemDacpacSsdtUri(constants.masterDacpac);
		should.equal(uri.fsPath, Uri.parse(path.join('$(NETCoreTargetsPath)', 'SystemDacpacs', '150', constants.masterDacpac)).fsPath);
		should.equal(ssdtUri.fsPath, Uri.parse(path.join('$(DacPacRootPath)', 'Extensions', 'Microsoft', 'SQLDB', 'Extensions', 'SqlServer', '150', 'SqlSchemas', constants.masterDacpac)).fsPath);

		project.changeTargetPlatform(constants.targetPlatformToVersion.get(constants.sqlServer2016)!);
		uri = project.getSystemDacpacUri(constants.masterDacpac);
		ssdtUri = project.getSystemDacpacSsdtUri(constants.masterDacpac);
		should.equal(uri.fsPath, Uri.parse(path.join('$(NETCoreTargetsPath)', 'SystemDacpacs', '130', constants.masterDacpac)).fsPath);
		should.equal(ssdtUri.fsPath, Uri.parse(path.join('$(DacPacRootPath)', 'Extensions', 'Microsoft', 'SQLDB', 'Extensions', 'SqlServer', '130', 'SqlSchemas', constants.masterDacpac)).fsPath);

		project.changeTargetPlatform(constants.targetPlatformToVersion.get(constants.sqlAzure)!);
		uri = project.getSystemDacpacUri(constants.masterDacpac);
		ssdtUri = project.getSystemDacpacSsdtUri(constants.masterDacpac);
		should.equal(uri.fsPath, Uri.parse(path.join('$(NETCoreTargetsPath)', 'SystemDacpacs', 'AzureV12', constants.masterDacpac)).fsPath);
		should.equal(ssdtUri.fsPath, Uri.parse(path.join('$(DacPacRootPath)', 'Extensions', 'Microsoft', 'SQLDB', 'Extensions', 'SqlServer', 'AzureV12', 'SqlSchemas', constants.masterDacpac)).fsPath);
	});

	it('Should choose correct msdb dacpac', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		let uri = project.getSystemDacpacUri(constants.msdbDacpac);
		let ssdtUri = project.getSystemDacpacSsdtUri(constants.msdbDacpac);
		should.equal(uri.fsPath, Uri.parse(path.join('$(NETCoreTargetsPath)', 'SystemDacpacs', '150', constants.msdbDacpac)).fsPath);
		should.equal(ssdtUri.fsPath, Uri.parse(path.join('$(DacPacRootPath)', 'Extensions', 'Microsoft', 'SQLDB', 'Extensions', 'SqlServer', '150', 'SqlSchemas', constants.msdbDacpac)).fsPath);

		project.changeTargetPlatform(constants.targetPlatformToVersion.get(constants.sqlServer2016)!);
		uri = project.getSystemDacpacUri(constants.msdbDacpac);
		ssdtUri = project.getSystemDacpacSsdtUri(constants.msdbDacpac);
		should.equal(uri.fsPath, Uri.parse(path.join('$(NETCoreTargetsPath)', 'SystemDacpacs', '130', constants.msdbDacpac)).fsPath);
		should.equal(ssdtUri.fsPath, Uri.parse(path.join('$(DacPacRootPath)', 'Extensions', 'Microsoft', 'SQLDB', 'Extensions', 'SqlServer', '130', 'SqlSchemas', constants.msdbDacpac)).fsPath);

		project.changeTargetPlatform(constants.targetPlatformToVersion.get(constants.sqlAzure)!);
		uri = project.getSystemDacpacUri(constants.msdbDacpac);
		ssdtUri = project.getSystemDacpacSsdtUri(constants.msdbDacpac);
		should.equal(uri.fsPath, Uri.parse(path.join('$(NETCoreTargetsPath)', 'SystemDacpacs', 'AzureV12', constants.msdbDacpac)).fsPath);
		should.equal(ssdtUri.fsPath, Uri.parse(path.join('$(DacPacRootPath)', 'Extensions', 'Microsoft', 'SQLDB', 'Extensions', 'SqlServer', 'AzureV12', 'SqlSchemas', constants.msdbDacpac)).fsPath);
	});

	it('Should throw error when choosing correct master dacpac if invalid DSP', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		project.changeTargetPlatform('invalidPlatform');
		await testUtils.shouldThrowSpecificError(async () => await project.getSystemDacpacUri(constants.masterDacpac), constants.invalidDataSchemaProvider);
	});

	it('Should add system database references correctly', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		should(project.databaseReferences.length).equal(0, 'There should be no datbase references to start with');
		await project.addSystemDatabaseReference({ databaseName: 'master', systemDb: SystemDatabase.master, suppressMissingDependenciesErrors: false });
		should(project.databaseReferences.length).equal(1, 'There should be one database reference after adding a reference to master');
		should(project.databaseReferences[0].databaseName).equal(constants.master, 'The database reference should be master');
		should(project.databaseReferences[0].suppressMissingDependenciesErrors).equal(false, 'project.databaseReferences[1].suppressMissingDependenciesErrors should be false');
		// make sure reference to ADS master dacpac and SSDT master dacpac was added
		let projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).containEql(convertSlashesForSqlProj(project.getSystemDacpacUri(constants.master).fsPath.substring(1)));
		should(projFileText).containEql(convertSlashesForSqlProj(project.getSystemDacpacSsdtUri(constants.master).fsPath.substring(1)));

		await project.addSystemDatabaseReference({ databaseName: 'msdb', systemDb: SystemDatabase.msdb, suppressMissingDependenciesErrors: false });
		should(project.databaseReferences.length).equal(2, 'There should be two database references after adding a reference to msdb');
		should(project.databaseReferences[1].databaseName).equal(constants.msdb, 'The database reference should be msdb');
		should(project.databaseReferences[1].suppressMissingDependenciesErrors).equal(false, 'project.databaseReferences[1].suppressMissingDependenciesErrors should be false');
		// make sure reference to ADS msdb dacpac and SSDT msdb dacpac was added
		projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).containEql(convertSlashesForSqlProj(project.getSystemDacpacUri(constants.msdb).fsPath.substring(1)));
		should(projFileText).containEql(convertSlashesForSqlProj(project.getSystemDacpacSsdtUri(constants.msdb).fsPath.substring(1)));
	});

	it('Should add a dacpac reference to the same database correctly', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		// add database reference in the same database
		should(project.databaseReferences.length).equal(0, 'There should be no database references to start with');
		await project.addDatabaseReference({ dacpacFileLocation: Uri.file('test1.dacpac'), suppressMissingDependenciesErrors: true });
		should(project.databaseReferences.length).equal(1, 'There should be a database reference after adding a reference to test1');
		should(project.databaseReferences[0].databaseName).equal('test1', 'The database reference should be test1');
		should(project.databaseReferences[0].suppressMissingDependenciesErrors).equal(true, 'project.databaseReferences[0].suppressMissingDependenciesErrors should be true');
		// make sure reference to test.dacpac was added
		let projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).containEql('test1.dacpac');
	});

	it('Should add a dacpac reference to a different database in the same server correctly', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		// add database reference to a different database on the same server
		should(project.databaseReferences.length).equal(0, 'There should be no database references to start with');
		await project.addDatabaseReference({
			dacpacFileLocation: Uri.file('test2.dacpac'),
			databaseName: 'test2DbName',
			databaseVariable: 'test2Db',
			suppressMissingDependenciesErrors: false
		});
		should(project.databaseReferences.length).equal(1, 'There should be a database reference after adding a reference to test2');
		should(project.databaseReferences[0].databaseName).equal('test2', 'The database reference should be test2');
		should(project.databaseReferences[0].suppressMissingDependenciesErrors).equal(false, 'project.databaseReferences[0].suppressMissingDependenciesErrors should be false');
		// make sure reference to test2.dacpac and SQLCMD variable was added
		let projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).containEql('test2.dacpac');
		should(projFileText).containEql('<DatabaseSqlCmdVariable>test2Db</DatabaseSqlCmdVariable>');
		should(projFileText).containEql('<SqlCmdVariable Include="test2Db">');
	});

	it('Should add a dacpac reference to a different database in a different server correctly', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		// add database reference to a different database on a different server
		should(project.databaseReferences.length).equal(0, 'There should be no database references to start with');
		await project.addDatabaseReference({
			dacpacFileLocation: Uri.file('test3.dacpac'),
			databaseName: 'test3DbName',
			databaseVariable: 'test3Db',
			serverName: 'otherServerName',
			serverVariable: 'otherServer',
			suppressMissingDependenciesErrors: false
		});
		should(project.databaseReferences.length).equal(1, 'There should be a database reference after adding a reference to test3');
		should(project.databaseReferences[0].databaseName).equal('test3', 'The database reference should be test3');
		should(project.databaseReferences[0].suppressMissingDependenciesErrors).equal(false, 'project.databaseReferences[0].suppressMissingDependenciesErrors should be false');
		// make sure reference to test3.dacpac and SQLCMD variables were added
		let projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).containEql('test3.dacpac');
		should(projFileText).containEql('<DatabaseSqlCmdVariable>test3Db</DatabaseSqlCmdVariable>');
		should(projFileText).containEql('<SqlCmdVariable Include="test3Db">');
		should(projFileText).containEql('<ServerSqlCmdVariable>otherServer</ServerSqlCmdVariable>');
		should(projFileText).containEql('<SqlCmdVariable Include="otherServer">');
	});

	it('Should add a project reference to the same database correctly', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		// add database reference to a different database on a different server
		should(project.databaseReferences.length).equal(0, 'There should be no database references to start with');
		should(Object.keys(project.sqlCmdVariables).length).equal(0, `There should be no sqlcmd variables to start with. Actual: ${Object.keys(project.sqlCmdVariables).length}`);
		await project.addProjectReference({
			projectName: 'project1',
			projectGuid: '',
			projectRelativePath: Uri.file(path.join('..','project1', 'project1.sqlproj')),
			suppressMissingDependenciesErrors: false
		});
		should(project.databaseReferences.length).equal(1, 'There should be a database reference after adding a reference to project1');
		should(project.databaseReferences[0].databaseName).equal('project1', 'The database reference should be project1');
		should(project.databaseReferences[0].suppressMissingDependenciesErrors).equal(false, 'project.databaseReferences[0].suppressMissingDependenciesErrors should be false');
		should(Object.keys(project.sqlCmdVariables).length).equal(0, `There should be no sqlcmd variables added. Actual: ${Object.keys(project.sqlCmdVariables).length}`);

		// make sure reference to project1 and SQLCMD variables were added
		let projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).containEql('project1');
	});

	it('Should add a project reference to a different database in the same server correctly', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		// add database reference to a different database on a different server
		should(project.databaseReferences.length).equal(0, 'There should be no database references to start with');
		should(Object.keys(project.sqlCmdVariables).length).equal(0, 'There should be no sqlcmd variables to start with');
		await project.addProjectReference({
			projectName: 'project1',
			projectGuid: '',
			projectRelativePath: Uri.file(path.join('..','project1', 'project1.sqlproj')),
			databaseName: 'testdbName',
			databaseVariable: 'testdb',
			suppressMissingDependenciesErrors: false
		});
		should(project.databaseReferences.length).equal(1, 'There should be a database reference after adding a reference to project1');
		should(project.databaseReferences[0].databaseName).equal('project1', 'The database reference should be project1');
		should(project.databaseReferences[0].suppressMissingDependenciesErrors).equal(false, 'project.databaseReferences[0].suppressMissingDependenciesErrors should be false');
		should(Object.keys(project.sqlCmdVariables).length).equal(1, `There should be one new sqlcmd variable added. Actual: ${Object.keys(project.sqlCmdVariables).length}`);

		// make sure reference to project1 and SQLCMD variables were added
		let projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).containEql('project1');
		should(projFileText).containEql('<DatabaseSqlCmdVariable>testdb</DatabaseSqlCmdVariable>');
		should(projFileText).containEql('<SqlCmdVariable Include="testdb">');
	});

	it('Should add a project reference to a different database in a different server correctly', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		// add database reference to a different database on a different server
		should(project.databaseReferences.length).equal(0, 'There should be no database references to start with');
		should(Object.keys(project.sqlCmdVariables).length).equal(0, 'There should be no sqlcmd variables to start with');
		await project.addProjectReference({
			projectName: 'project1',
			projectGuid: '',
			projectRelativePath: Uri.file(path.join('..','project1', 'project1.sqlproj')),
			databaseName: 'testdbName',
			databaseVariable: 'testdb',
			serverName: 'otherServerName',
			serverVariable: 'otherServer',
			suppressMissingDependenciesErrors: false
		});
		should(project.databaseReferences.length).equal(1, 'There should be a database reference after adding a reference to project1');
		should(project.databaseReferences[0].databaseName).equal('project1', 'The database reference should be project1');
		should(project.databaseReferences[0].suppressMissingDependenciesErrors).equal(false, 'project.databaseReferences[0].suppressMissingDependenciesErrors should be false');
		should(Object.keys(project.sqlCmdVariables).length).equal(2, `There should be two new sqlcmd variables added. Actual: ${Object.keys(project.sqlCmdVariables).length}`);

		// make sure reference to project1 and SQLCMD variables were added
		let projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).containEql('project1');
		should(projFileText).containEql('<DatabaseSqlCmdVariable>testdb</DatabaseSqlCmdVariable>');
		should(projFileText).containEql('<SqlCmdVariable Include="testdb">');
		should(projFileText).containEql('<ServerSqlCmdVariable>otherServer</ServerSqlCmdVariable>');
		should(projFileText).containEql('<SqlCmdVariable Include="otherServer">');
	});

	it('Should not allow adding duplicate database references', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project = await Project.openProject(projFilePath);

		should(project.databaseReferences.length).equal(0, 'There should be no database references to start with');
		await project.addSystemDatabaseReference({ databaseName: 'master', systemDb: SystemDatabase.master, suppressMissingDependenciesErrors: false });
		should(project.databaseReferences.length).equal(1, 'There should be one database reference after adding a reference to master');
		should(project.databaseReferences[0].databaseName).equal(constants.master, 'project.databaseReferences[0].databaseName should be master');

		// try to add reference to master again
		await testUtils.shouldThrowSpecificError(async () => await project.addSystemDatabaseReference({ databaseName: 'master', systemDb: SystemDatabase.master, suppressMissingDependenciesErrors: false }), constants.databaseReferenceAlreadyExists);
		should(project.databaseReferences.length).equal(1, 'There should only be one database reference after trying to add a reference to master again');

		await project.addDatabaseReference({ dacpacFileLocation: Uri.file('test.dacpac'), suppressMissingDependenciesErrors: false });
		should(project.databaseReferences.length).equal(2, 'There should be two database references after adding a reference to test.dacpac');
		should(project.databaseReferences[1].databaseName).equal('test', 'project.databaseReferences[1].databaseName should be test');

		// try to add reference to test.dacpac again
		await testUtils.shouldThrowSpecificError(async () => await project.addDatabaseReference({ dacpacFileLocation: Uri.file('test.dacpac'), suppressMissingDependenciesErrors: false }), constants.databaseReferenceAlreadyExists);
		should(project.databaseReferences.length).equal(2, 'There should be two database references after trying to add a reference to test.dacpac again');
	});

	it('Should add pre and post deployment scripts as entries to sqlproj', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project: Project = await Project.openProject(projFilePath);

		const folderPath = 'Pre-Post Deployment Scripts';
		const preDeploymentScriptFilePath = path.join(folderPath, 'Script.PreDeployment1.sql');
		const postDeploymentScriptFilePath = path.join(folderPath, 'Script.PostDeployment1.sql');
		const fileContents = ' ';

		await project.addFolderItem(folderPath);
		await project.addScriptItem(preDeploymentScriptFilePath, fileContents, templates.preDeployScript);
		await project.addScriptItem(postDeploymentScriptFilePath, fileContents, templates.postDeployScript);

		const newProject = await Project.openProject(projFilePath);

		should(newProject.preDeployScripts.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(preDeploymentScriptFilePath))).not.equal(undefined, 'File Script.PreDeployment1.sql not read');
		should(newProject.postDeployScripts.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(postDeploymentScriptFilePath))).not.equal(undefined, 'File Script.PostDeployment1.sql not read');
	});

	it('Should show information messages when adding more than one pre/post deployment scripts to sqlproj', async function (): Promise<void> {
		const stub = sinon.stub(window, 'showInformationMessage').returns(<any>Promise.resolve());

		projFilePath = await testUtils.createTestSqlProjFile(baselines.newProjectFileBaseline);
		const project: Project = await Project.openProject(projFilePath);

		const folderPath = 'Pre-Post Deployment Scripts';
		const preDeploymentScriptFilePath = path.join(folderPath, 'Script.PreDeployment1.sql');
		const postDeploymentScriptFilePath = path.join(folderPath, 'Script.PostDeployment1.sql');
		const preDeploymentScriptFilePath2 = path.join(folderPath, 'Script.PreDeployment2.sql');
		const postDeploymentScriptFilePath2 = path.join(folderPath, 'Script.PostDeployment2.sql');
		const fileContents = ' ';

		await project.addFolderItem(folderPath);
		await project.addScriptItem(preDeploymentScriptFilePath, fileContents, templates.preDeployScript);
		await project.addScriptItem(postDeploymentScriptFilePath, fileContents, templates.postDeployScript);

		await project.addScriptItem(preDeploymentScriptFilePath2, fileContents, templates.preDeployScript);
		should(stub.calledWith(constants.deployScriptExists(constants.PreDeploy))).be.true(`showInformationMessage not called with expected message '${constants.deployScriptExists(constants.PreDeploy)}' Actual '${stub.getCall(0).args[0]}'`);

		await project.addScriptItem(postDeploymentScriptFilePath2, fileContents, templates.postDeployScript);
		should(stub.calledWith(constants.deployScriptExists(constants.PostDeploy))).be.true(`showInformationMessage not called with expected message '${constants.deployScriptExists(constants.PostDeploy)}' Actual '${stub.getCall(0).args[0]}'`);

		const newProject = await Project.openProject(projFilePath);

		should(newProject.preDeployScripts.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(preDeploymentScriptFilePath))).not.equal(undefined, 'File Script.PreDeployment1.sql not read');
		should(newProject.postDeployScripts.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(postDeploymentScriptFilePath))).not.equal(undefined, 'File Script.PostDeployment1.sql not read');
		should(newProject.noneDeployScripts.length).equal(2);
		should(newProject.noneDeployScripts.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(preDeploymentScriptFilePath2))).not.equal(undefined, 'File Script.PreDeployment2.sql not read');
		should(newProject.noneDeployScripts.find(f => f.type === EntryType.File && f.relativePath === convertSlashesForSqlProj(postDeploymentScriptFilePath2))).not.equal(undefined, 'File Script.PostDeployment2.sql not read');

	});
});

describe('Project: add SQLCMD Variables', function (): void {
	before(async function (): Promise<void> {
		await baselines.loadBaselines();
	});

	it('Should update .sqlproj with new sqlcmd variables', async function (): Promise<void> {
		projFilePath = await testUtils.createTestSqlProjFile(baselines.openProjectFileBaseline);
		const project = await Project.openProject(projFilePath);
		should(Object.keys(project.sqlCmdVariables).length).equal(2);

		// add a new variable
		await project.addSqlCmdVariable('TestDatabaseName', 'TestDb');

		// add a variable with the same name as an existing sqlcmd variable and the old entry should be replaced with the new one
		await project.addSqlCmdVariable('ProdDatabaseName', 'NewProdName');

		should(Object.keys(project.sqlCmdVariables).length).equal(3);
		should(project.sqlCmdVariables['TestDatabaseName']).equal('TestDb');
		should(project.sqlCmdVariables['ProdDatabaseName']).equal('NewProdName', 'ProdDatabaseName value should have been updated to the new value');

		const projFileText = (await fs.readFile(projFilePath)).toString();
		should(projFileText).equal(baselines.openSqlProjectWithAdditionalSqlCmdVariablesBaseline.trim());
	});
});

describe('Project: round trip updates', function (): void {
	before(async function (): Promise<void> {
		await baselines.loadBaselines();
	});

	it('Should update SSDT project to work in ADS', async function (): Promise<void> {
		await testUpdateInRoundTrip(baselines.SSDTProjectFileBaseline, baselines.SSDTProjectAfterUpdateBaseline, true, true);
	});

	it('Should update SSDT project with new system database references', async function (): Promise<void> {
		await testUpdateInRoundTrip(baselines.SSDTUpdatedProjectBaseline, baselines.SSDTUpdatedProjectAfterSystemDbUpdateBaseline, false, true);
	});

	it('Should update SSDT project to work in ADS handling pre-exsiting targets', async function (): Promise<void> {
		await testUpdateInRoundTrip(baselines.SSDTProjectBaselineWithCleanTarget, baselines.SSDTProjectBaselineWithCleanTargetAfterUpdate, true, false);
	});
});

async function testUpdateInRoundTrip(fileBeforeupdate: string, fileAfterUpdate: string, testTargets: boolean, testReferences: boolean): Promise<void> {
	projFilePath = await testUtils.createTestSqlProjFile(fileBeforeupdate);
	const project = await Project.openProject(projFilePath);

	if (testTargets) {
		await testUpdateTargetsImportsRoundTrip(project);
	}

	if (testReferences) {
		await testAddReferencesInRoundTrip(project);
	}

	let projFileText = (await fs.readFile(projFilePath)).toString();
	should(projFileText).equal(fileAfterUpdate.trim());
}

async function testUpdateTargetsImportsRoundTrip(project: Project): Promise<void> {
	should(project.importedTargets.length).equal(2);
	await project.updateProjectForRoundTrip();
	should(await exists(projFilePath + '_backup')).equal(true);	// backup file should be generated before the project is updated
	should(project.importedTargets.length).equal(3);	// additional target added by updateProjectForRoundTrip method
}

async function testAddReferencesInRoundTrip(project: Project): Promise<void> {
	// updating system db refs is separate from updating for roundtrip because new db refs could be added even after project is updated for roundtrip
	should(project.containsSSDTOnlySystemDatabaseReferences()).equal(true);
	await project.updateSystemDatabaseReferencesInProjFile();
}
