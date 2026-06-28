import * as React from 'react';

export const Fragment = React.Fragment;

/**
 * JSX runtime shim for third-party deps (e.g. @uiw/react-codemirror) that import
 * react/jsx-runtime. Uses the host React module directly instead of the SDK runtime.
 */
function build(type, props, key) {
  const { children, ...rest } = props ?? {};
  if (key !== undefined) {
    rest.key = key;
  }
  return React.createElement(type, props === null ? props : rest, children);
}

export const jsx = build;
export const jsxs = build;
