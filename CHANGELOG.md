# Changelog

## 0.4.0-alpha.1

## 0.4.0-alpha.0

- Replaces per-session scheduled disconnects with a deployment-wide batch
  worker.

## 0.3.2

- Patches instead of re-creating timeout documents for efficiency

## 0.3.1

- Avoids self-cancelation of scheduled functions, now that mutations aren't
  allowed to cancel themselves.

## 0.3.0

- Adds /test and /\_generated/component.js entrypoints
- Drops commonjs support
- Improves source mapping for generated files
- Changes to a statically generated component API
