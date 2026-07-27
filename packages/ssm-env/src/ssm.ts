import {
  GetParametersCommand,
  SSMClient,
  type GetParametersCommandOutput,
  type SSMClientConfig,
} from "@aws-sdk/client-ssm";
import { fromIni } from "@aws-sdk/credential-providers";

import type { SsmEnvConfig } from "./config";

const GET_PARAMETERS_LIMIT = 10;

export interface GetParametersSender {
  send(command: GetParametersCommand): Promise<GetParametersCommandOutput>;
}

export interface FetchSsmEnvResult {
  values: Record<string, string>;
  missingParameters: string[];
}

export function createSsmClient(config: SsmEnvConfig): SSMClient {
  const clientConfig: SSMClientConfig = {};
  if (config.region !== undefined) clientConfig.region = config.region;
  if (config.profile !== undefined) {
    clientConfig.credentials = fromIni({ profile: config.profile });
  }
  return new SSMClient(clientConfig);
}

export async function fetchSsmEnv(
  client: GetParametersSender,
  parameters: Record<string, string>,
): Promise<FetchSsmEnvResult> {
  const parameterNames = [...new Set(Object.values(parameters))];
  const valuesByParameter = new Map<string, string>();

  for (let index = 0; index < parameterNames.length; index += GET_PARAMETERS_LIMIT) {
    const names = parameterNames.slice(index, index + GET_PARAMETERS_LIMIT);
    const response = await client.send(
      new GetParametersCommand({
        Names: names,
        WithDecryption: true,
      }),
    );

    for (const parameter of response.Parameters ?? []) {
      if (parameter.Name !== undefined && parameter.Value !== undefined) {
        valuesByParameter.set(parameter.Name, parameter.Value);
      }
    }
  }

  const values: Record<string, string> = {};
  for (const [envName, parameterName] of Object.entries(parameters)) {
    const value = valuesByParameter.get(parameterName);
    if (value !== undefined) values[envName] = value;
  }

  return {
    values,
    missingParameters: parameterNames.filter(
      (parameterName) => !valuesByParameter.has(parameterName),
    ),
  };
}
