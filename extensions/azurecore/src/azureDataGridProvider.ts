/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azdata from 'azdata';
import { AppContext } from './appContext';
import { AzureResourceServiceNames } from './azureResource/constants';
import { IAzureResourceSubscriptionService } from './azureResource/interfaces';
import { TokenCredentials } from '@azure/ms-rest-js';
import { azureResource } from 'azureResource';
import * as azureResourceUtils from './azureResource/utils';
import * as constants from './constants';
import * as loc from './localizedConstants';
import * as utils from './utils';

const typesClause = [
	azureResource.AzureResourceType.sqlDatabase,
	azureResource.AzureResourceType.sqlServer,
	azureResource.AzureResourceType.sqlManagedInstance,
	azureResource.AzureResourceType.postgresServer,
	azureResource.AzureResourceType.azureArcService,
	azureResource.AzureResourceType.azureArcSqlManagedInstance,
	azureResource.AzureResourceType.azureArcPostgresServer
].map(type => `type == "${type}"`).join(' or ');

export class AzureDataGridProvider implements azdata.DataGridProvider {
	constructor(private _appContext: AppContext) { }

	public providerId = constants.dataGridProviderId;
	public async getDataGridItems() {
		const accounts = await azdata.accounts.getAllAccounts();
		const items: any[] = [];
		await Promise.all(accounts.map(async (account) => {
			await Promise.all(account.properties.tenants.map(async (tenant: { id: string; }) => {
				try {
					const tokenResponse = await azdata.accounts.getAccountSecurityToken(account, tenant.id, azdata.AzureResource.ResourceManagement);
					const token = tokenResponse.token;
					const tokenType = tokenResponse.tokenType;
					const credential = new TokenCredentials(token, tokenType);
					const subscriptionService = this._appContext.getService<IAzureResourceSubscriptionService>(AzureResourceServiceNames.subscriptionService);
					const subscriptions = await subscriptionService.getSubscriptions(account, credential, tenant.id);
					try {
						const newItems = (await azureResourceUtils.runResourceQuery(account, subscriptions, true, `where ${typesClause}`)).resources
							.map(item => {
								return <azdata.DataGridItem>{
									id: item.id,
									fieldValues: {
										nameLink: <azdata.DataGridHyperlinkInfo>{ displayText: item.name, linkOrCommand: 'https://microsoft.com' },
										name: item.name,
										resourceGroup: item.resourceGroup,
										subscriptionId: item.subscriptionId,
										subscriptionName: subscriptions.find(subscription => subscription.id === item.subscriptionId)?.name ?? item.subscriptionId,
										locationDisplayName: utils.getRegionDisplayName(item.location),
										type: item.type,
										typeDisplayName: utils.getResourceTypeDisplayName(item.type),
										iconPath: utils.getResourceTypeIcon(this._appContext, item.type),
										portalEndpoint: account.properties.providerSettings.settings.portalEndpoint
									}
								};
							});
						items.push(...newItems);
					} catch (err) {
						console.log(err);
					}
				} catch (err) {
					console.log(err);
				}
			}));
		}));
		return items;
	}

	public async getDataGridColumns(): Promise<azdata.DataGridColumn[]> {
		return [
			{ id: 'icon', type: 'image', field: 'iconPath', name: '', width: 25, sortable: false, filterable: false, resizable: false, tooltip: loc.typeIcon },
			{ id: 'name', type: 'hyperlink', field: 'nameLink', name: loc.name, width: 150 },
			{ id: 'type', type: 'text', field: 'typeDisplayName', name: loc.resourceType, width: 150 },
			{ id: 'type', type: 'text', field: 'resourceGroup', name: loc.resourceGroup, width: 150 },
			{ id: 'location', type: 'text', field: 'locationDisplayName', name: loc.location, width: 150 },
			{ id: 'subscriptionId', type: 'text', field: 'subscriptionName', name: loc.subscription, width: 150 }
		];
	}
}
