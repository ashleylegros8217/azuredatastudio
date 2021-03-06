/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as azdata from 'azdata';
import * as azdataExt from 'azdata-ext';
import * as loc from '../../../localizedConstants';
import { IconPathHelper, cssStyles } from '../../../constants';
import { DashboardPage } from '../../components/dashboardPage';
import { PostgresModel } from '../../../models/postgresModel';
import { convertToGibibyteString } from '../../../common/utils';

export class PostgresComputeAndStoragePage extends DashboardPage {
	private workerContainer?: azdata.DivContainer;

	private workerBox?: azdata.InputBoxComponent;
	private coresLimitBox?: azdata.InputBoxComponent;
	private coresRequestBox?: azdata.InputBoxComponent;
	private memoryLimitBox?: azdata.InputBoxComponent;
	private memoryRequestBox?: azdata.InputBoxComponent;

	private discardButton?: azdata.ButtonComponent;
	private saveButton?: azdata.ButtonComponent;

	private saveArgs: {
		workers?: number,
		coresLimit?: string,
		coresRequest?: string,
		memoryLimit?: string,
		memoryRequest?: string
	} = {};

	private readonly _azdataApi: azdataExt.IExtension;

	constructor(protected modelView: azdata.ModelView, private _postgresModel: PostgresModel) {
		super(modelView);
		this._azdataApi = vscode.extensions.getExtension(azdataExt.extension.name)?.exports;

		this.initializeConfigurationBoxes();

		this.disposables.push(this._postgresModel.onConfigUpdated(
			() => this.eventuallyRunOnInitialized(() => this.handleServiceUpdated())));
	}

	protected get title(): string {
		return loc.computeAndStorage;
	}

	protected get id(): string {
		return 'postgres-compute-and-storage';
	}

	protected get icon(): { dark: string; light: string; } {
		return IconPathHelper.computeStorage;
	}

	protected get container(): azdata.Component {
		const root = this.modelView.modelBuilder.divContainer().component();
		const content = this.modelView.modelBuilder.divContainer().component();
		root.addItem(content, { CSSStyles: { 'margin': '20px' } });

		content.addItem(this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.computeAndStorage,
			CSSStyles: { ...cssStyles.title }
		}).component());

		const infoComputeStorage_p1 = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.computeAndStorageDescriptionPartOne,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px', 'max-width': 'auto' }
		}).component();
		const infoComputeStorage_p2 = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.computeAndStorageDescriptionPartTwo,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const workerNodeslink = this.modelView.modelBuilder.hyperlink().withProperties<azdata.HyperlinkComponentProperties>({
			label: loc.addingWokerNodes,
			url: 'https://docs.microsoft.com/azure/azure-arc/data/scale-up-down-postgresql-hyperscale-server-group-using-cli',
			CSSStyles: { 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const infoComputeStorage_p3 = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.computeAndStorageDescriptionPartThree,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const memoryVCoreslink = this.modelView.modelBuilder.hyperlink().withProperties<azdata.HyperlinkComponentProperties>({
			label: loc.scalingCompute,
			url: 'https://docs.microsoft.com/azure/azure-arc/data/scale-up-down-postgresql-hyperscale-server-group-using-cli',
			CSSStyles: { 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const infoComputeStorage_p4 = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.computeAndStorageDescriptionPartFour,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const infoComputeStorage_p5 = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.computeAndStorageDescriptionPartFive,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const infoComputeStorage_p6 = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.computeAndStorageDescriptionPartSix,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const computeInfoAndLinks = this.modelView.modelBuilder.flexContainer().withLayout({ flexWrap: 'wrap' }).component();
		computeInfoAndLinks.addItem(infoComputeStorage_p1, { CSSStyles: { 'margin-right': '5px' } });
		computeInfoAndLinks.addItem(infoComputeStorage_p2, { CSSStyles: { 'margin-right': '5px' } });
		computeInfoAndLinks.addItem(workerNodeslink, { CSSStyles: { 'margin-right': '5px' } });
		computeInfoAndLinks.addItem(infoComputeStorage_p3, { CSSStyles: { 'margin-right': '5px' } });
		computeInfoAndLinks.addItem(memoryVCoreslink, { CSSStyles: { 'margin-right': '5px' } });
		computeInfoAndLinks.addItem(infoComputeStorage_p4, { CSSStyles: { 'margin-right': '5px' } });
		computeInfoAndLinks.addItem(infoComputeStorage_p5, { CSSStyles: { 'margin-right': '5px' } });
		computeInfoAndLinks.addItem(infoComputeStorage_p6, { CSSStyles: { 'margin-right': '5px' } });
		content.addItem(computeInfoAndLinks, { CSSStyles: { 'min-height': '30px' } });



		this.workerContainer = this.modelView.modelBuilder.divContainer().component();
		this.handleServiceUpdated();
		content.addItem(this.workerContainer, { CSSStyles: { 'min-height': '30px' } });

		this.initialized = true;

		return root;
	}

	protected get toolbarContainer(): azdata.ToolbarContainer {
		// Save Edits
		this.saveButton = this.modelView.modelBuilder.button().withProperties<azdata.ButtonProperties>({
			label: loc.saveText,
			iconPath: IconPathHelper.save,
			enabled: false
		}).component();

		this.disposables.push(
			this.saveButton.onDidClick(async () => {
				this.saveButton!.enabled = false;
				this.discardButton!.enabled = false;
				this.workerBox!.value = '';
				this.coresRequestBox!.value = '';
				this.coresLimitBox!.value = '';
				this.memoryRequestBox!.value = '';
				this.memoryLimitBox!.value = '';
				try {
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: loc.updatingInstance(this._postgresModel.info.name),
							cancellable: false
						},
						(_progress, _token) => {
							return this._azdataApi.azdata.arc.postgres.server.edit(
								this._postgresModel.info.name, this.saveArgs);
						}
					);

					this._postgresModel.refresh();

					vscode.window.showInformationMessage(loc.instanceUpdated(this._postgresModel.info.name));

				} catch (error) {
					vscode.window.showErrorMessage(loc.instanceUpdateFailed(this._postgresModel.info.name, error));
				}
			}));

		// Discard
		this.discardButton = this.modelView.modelBuilder.button().withProperties<azdata.ButtonProperties>({
			label: loc.discardText,
			iconPath: IconPathHelper.discard,
			enabled: false
		}).component();

		this.disposables.push(
			this.discardButton.onDidClick(async () => {
				this.discardButton!.enabled = false;
				try {
					this.editWorkerNodeCount();
					this.editCores();
					this.editMemory();
				} catch (error) {
					vscode.window.showErrorMessage(loc.pageDiscardFailed(error));
				} finally {
					this.saveButton!.enabled = false;
				}
			}));

		return this.modelView.modelBuilder.toolbarContainer().withToolbarItems([
			{ component: this.saveButton },
			{ component: this.discardButton }
		]).component();
	}

	private initializeConfigurationBoxes() {
		this.workerBox = this.modelView.modelBuilder.inputBox().withProperties<azdata.InputBoxProperties>({
			readOnly: false,
			validationErrorMessage: loc.workerValidationErrorMessage,
			inputType: 'number'
		}).component();

		this.disposables.push(
			this.workerBox!.onTextChanged(() => {
				if (!(this.handleOnTextChanged(this.workerBox!))) {
					this.saveArgs.workers = undefined;
				} else {
					this.saveArgs.workers = parseInt(this.workerBox!.value!);
				}
			})
		);

		this.coresLimitBox = this.modelView.modelBuilder.inputBox().withProperties<azdata.InputBoxProperties>({
			readOnly: false,
			min: 1,
			validationErrorMessage: loc.coresValidationErrorMessage,
			inputType: 'number'
		}).component();

		this.disposables.push(
			this.coresLimitBox!.onTextChanged(() => {
				if (!(this.handleOnTextChanged(this.coresLimitBox!))) {
					this.saveArgs.coresLimit = undefined;
				} else {
					this.saveArgs.coresLimit = this.coresLimitBox!.value;
				}
			})
		);

		this.coresRequestBox = this.modelView.modelBuilder.inputBox().withProperties<azdata.InputBoxProperties>({
			readOnly: false,
			min: 1,
			validationErrorMessage: loc.coresValidationErrorMessage,
			inputType: 'number'
		}).component();

		this.disposables.push(
			this.coresRequestBox!.onTextChanged(() => {
				if (!(this.handleOnTextChanged(this.coresRequestBox!))) {
					this.saveArgs.coresRequest = undefined;
				} else {
					this.saveArgs.coresRequest = this.coresRequestBox!.value;
				}
			})
		);

		this.memoryLimitBox = this.modelView.modelBuilder.inputBox().withProperties<azdata.InputBoxProperties>({
			readOnly: false,
			min: 0.25,
			validationErrorMessage: loc.memoryLimitValidationErrorMessage,
			inputType: 'number'
		}).component();

		this.disposables.push(
			this.memoryLimitBox!.onTextChanged(() => {
				if (!(this.handleOnTextChanged(this.memoryLimitBox!))) {
					this.saveArgs.memoryLimit = undefined;
				} else {
					this.saveArgs.memoryLimit = this.memoryLimitBox!.value + 'Gi';
				}
			})
		);

		this.memoryRequestBox = this.modelView.modelBuilder.inputBox().withProperties<azdata.InputBoxProperties>({
			readOnly: false,
			min: 0.25,
			validationErrorMessage: loc.memoryRequestValidationErrorMessage,
			inputType: 'number'
		}).component();

		this.disposables.push(
			this.memoryRequestBox!.onTextChanged(() => {
				if (!(this.handleOnTextChanged(this.memoryRequestBox!))) {
					this.saveArgs.memoryRequest = undefined;
				} else {
					this.saveArgs.memoryRequest = this.memoryRequestBox!.value + 'Gi';
				}
			})
		);

	}

	private createWorkerNodesSectionContainer(): azdata.FlexContainer {
		const inputFlex = { flex: '0 1 150px' };
		const keyFlex = { flex: `0 1 250px` };

		const flexContainer = this.modelView.modelBuilder.flexContainer().withLayout({
			flexWrap: 'wrap',
			alignItems: 'center'
		}).component();

		const keyComponent = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.workerNodeCount,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const keyContainer = this.modelView.modelBuilder.flexContainer().withLayout({ alignItems: 'center' }).component();
		keyContainer.addItem(keyComponent, { CSSStyles: { 'margin-right': '0px', 'margin-bottom': '15px' } });

		const information = this.modelView.modelBuilder.button().withProperties<azdata.ButtonProperties>({
			iconPath: IconPathHelper.information,
			title: loc.workerNodesInformation,
			width: '12px',
			height: '12px',
			enabled: false
		}).component();

		keyContainer.addItem(information, { CSSStyles: { 'margin-left': '5px', 'margin-bottom': '15px' } });
		flexContainer.addItem(keyContainer, keyFlex);

		const inputContainer = this.modelView.modelBuilder.flexContainer().withLayout({ alignItems: 'center' }).component();
		inputContainer.addItem(this.workerBox!, { CSSStyles: { 'margin-bottom': '15px', 'min-width': '50px', 'max-width': '225px' } });

		flexContainer.addItem(inputContainer, inputFlex);

		return flexContainer;
	}

	private createConfigurationSectionContainer(key: string, input: azdata.Component): azdata.FlexContainer {
		const inputFlex = { flex: '0 1 150px' };
		const keyFlex = { flex: `0 1 250px` };

		const flexContainer = this.modelView.modelBuilder.flexContainer().withLayout({
			flexWrap: 'wrap',
			alignItems: 'center'
		}).component();

		const keyComponent = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: key,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const keyContainer = this.modelView.modelBuilder.flexContainer().withLayout({ alignItems: 'center' }).component();
		keyContainer.addItem(keyComponent, { CSSStyles: { 'margin-right': '0px', 'margin-bottom': '15px' } });
		flexContainer.addItem(keyContainer, keyFlex);

		const inputContainer = this.modelView.modelBuilder.flexContainer().withLayout({ alignItems: 'center' }).component();
		inputContainer.addItem(input, { CSSStyles: { 'margin-bottom': '15px', 'min-width': '50px', 'max-width': '225px' } });

		flexContainer.addItem(inputContainer, inputFlex);

		return flexContainer;
	}

	private handleOnTextChanged(component: azdata.InputBoxComponent): boolean {
		if ((!component.value)) {
			// if there is no text found in the inputbox component return false
			return false;
		} else if ((!component.valid)) {
			// if value given by user is not valid enable discard button for user
			// to clear all inputs and return false
			this.discardButton!.enabled = true;
			return false;
		} else {
			// if a valid value has been entered into the input box, enable save and discard buttons
			// so that user could choose to either edit instance or clear all inputs
			// return true
			this.saveButton!.enabled = true;
			this.discardButton!.enabled = true;
			return true;
		}

	}

	private editWorkerNodeCount() {
		// scale.shards was renamed to scale.workers. Check both for backwards compatibility.
		let scale = this._postgresModel.config?.spec.scale;
		let currentWorkers = scale?.workers ?? scale?.shards ?? 0;

		this.workerBox!.min = currentWorkers;
		this.workerBox!.placeHolder = currentWorkers.toString();
		this.workerBox!.value = '';

		this.saveArgs.workers = undefined;
	}

	private createCoresMemorySection(): azdata.DivContainer {
		const titleFlex = { flex: `0 1 250px` };

		const flexContainer = this.modelView.modelBuilder.flexContainer().withLayout({
			flexWrap: 'wrap',
			alignItems: 'center'
		}).component();

		const titleComponent = this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
			value: loc.configurationPerNode,
			CSSStyles: { ...cssStyles.title, 'font-weight': 'bold', 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const titleContainer = this.modelView.modelBuilder.flexContainer().withLayout({ alignItems: 'center' }).component();
		titleContainer.addItem(titleComponent, { CSSStyles: { 'margin-right': '0px', 'margin-bottom': '15px' } });

		const information = this.modelView.modelBuilder.button().withProperties<azdata.ButtonProperties>({
			iconPath: IconPathHelper.information,
			title: loc.configurationInformation,
			width: '12px',
			height: '12px',
			enabled: false
		}).component();

		titleContainer.addItem(information, { CSSStyles: { 'margin-left': '5px', 'margin-bottom': '15px' } });
		flexContainer.addItem(titleContainer, titleFlex);

		let configurationSection = this.modelView.modelBuilder.divContainer().component();
		configurationSection.addItem(flexContainer);

		return configurationSection;
	}

	private editCores() {
		let currentCPUSize = this._postgresModel.config?.spec.scheduling?.default?.resources?.requests?.cpu;

		if (!currentCPUSize) {
			currentCPUSize = '';
		}

		this.coresRequestBox!.placeHolder = currentCPUSize;
		this.coresRequestBox!.value = '';
		this.saveArgs.coresRequest = undefined;

		currentCPUSize = this._postgresModel.config?.spec.scheduling?.default?.resources?.limits?.cpu;

		if (!currentCPUSize) {
			currentCPUSize = '';
		}

		this.coresLimitBox!.placeHolder = currentCPUSize;
		this.coresLimitBox!.value = '';
		this.saveArgs.coresLimit = undefined;
	}

	private editMemory() {
		let currentMemSizeConversion: string;
		let currentMemorySize = this._postgresModel.config?.spec.scheduling?.default?.resources?.requests?.memory;

		if (!currentMemorySize) {
			currentMemSizeConversion = '';
		} else {
			currentMemSizeConversion = convertToGibibyteString(currentMemorySize);
		}

		this.memoryRequestBox!.placeHolder = currentMemSizeConversion!;
		this.memoryRequestBox!.value = '';

		this.saveArgs.memoryRequest = undefined;

		currentMemorySize = this._postgresModel.config?.spec.scheduling?.default?.resources?.limits?.memory;

		if (!currentMemorySize) {
			currentMemSizeConversion = '';
		} else {
			currentMemSizeConversion = convertToGibibyteString(currentMemorySize);
		}

		this.memoryLimitBox!.placeHolder = currentMemSizeConversion!;
		this.memoryLimitBox!.value = '';

		this.saveArgs.memoryLimit = undefined;
	}

	private handleServiceUpdated() {
		if (this._postgresModel.configLastUpdated) {
			this.editWorkerNodeCount();
			this.editCores();
			this.editMemory();

			// Workaround https://github.com/microsoft/azuredatastudio/issues/13134
			// by only adding these once the model has data. After the bug is fixed,
			// use loading indicators instead of keeping the page blank.
			if (this.workerContainer?.items.length === 0) {
				this.workerContainer.addItem(this.modelView.modelBuilder.text().withProperties<azdata.TextComponentProperties>({
					value: loc.workerNodes,
					CSSStyles: { ...cssStyles.title, 'margin-top': '25px' }
				}).component());

				this.workerContainer.addItems([
					this.createWorkerNodesSectionContainer(),
					this.createCoresMemorySection(),
					this.createConfigurationSectionContainer(loc.coresRequest, this.coresRequestBox!),
					this.createConfigurationSectionContainer(loc.coresLimit, this.coresLimitBox!),
					this.createConfigurationSectionContainer(loc.memoryRequest, this.memoryRequestBox!),
					this.createConfigurationSectionContainer(loc.memoryLimit, this.memoryLimitBox!)

				]);
			}
		}
	}
}
