# @pi-lab/ssm-env [![NPM Version](https://img.shields.io/npm/v/@pi-lab/ssm-env)](https://www.npmjs.com/package/@pi-lab/ssm-env)

Load environment variables from AWS Systems Manager Parameter Store into pi.

## Install

```bash
pi install npm:@pi-lab/ssm-env
```

## Usage

Map local environment variable names explicitly to Parameter Store parameter names:

```json
// ~/.pi/agent/settings.json or .pi/settings.json
{
  "ssmEnv": {
    "profile": "company-dev",
    "region": "ap-southeast-1",
    "parameters": {
      "DATABASE_URL": "/example/dev/DATABASE_URL",
      "REDIS_URL": "/example/dev/REDIS_URL"
    }
  }
}
```

`profile` and `region` are optional. When omitted, the AWS SDK default credential and Region provider chains are used. A trusted project's `ssmEnv` object replaces the global `ssmEnv` object; project configuration is ignored when the project is untrusted.

Establish your AWS session before starting pi. For example:

```bash
aws sso login --profile company-dev
pi
```

The extension uses the AWS SDK v3 credential chain and existing AWS CLI/SDK profile and cached SSO session. It never invokes AWS CLI or starts a login flow.

## Behavior

- Fetches parameters on every session start, in batches of at most 10
- Always requests decryption, which works for both `SecureString` and unencrypted parameters
- Preserves environment variables already present in the pi process
- Warns about missing parameters while loading values that exist
- Warns on configuration, authentication, network, and SSM failures without preventing session startup
- Refreshes values previously injected by this extension after session replacement or extension reload
- Never logs parameter values or writes them to disk

`@pi-lab/ssm-env` is independent of `@pi-lab/env`. Do not configure the same variable in both packages: each preserves existing variables, so plugin load order would determine which source wins.
