import slash from "slash";
import { join, normalize, parse, relative } from "path";
import { Config, InputOutputMapping, TsToZodConfig } from "../config";

/**
 * Resolve the path of an import.
 *
 * @param from path of the current file
 * @param to path of the import file
 * @returns relative path without extension
 */
export function getImportPath(from: string, to: string) {
  const relativePath = slash(relative(from, to).slice(1));
  const { dir, name } = parse(relativePath);

  return `${dir}/${name}`;
}

export function getInputOutputMappings(
  config: TsToZodConfig | undefined
): InputOutputMapping[] {
  if (!config) return [];
  if (Array.isArray(config)) {
    return config.map(({ input, output, getSchemaName }) => ({
      input,
      output,
      getSchemaName,
    }));
  }
  const { input, output, getSchemaName } = config as Config;
  return [{ input, output, getSchemaName }];
}

export function areImportPathsEqualIgnoringExtension(
  path1: string,
  path2: string
): boolean {
  return relative(normalizePath(path1), normalizePath(path2)) === "";
}

const normalizePath = (path: string) => {
  const { dir, name } = parse(normalize(path));
  return join(dir, name);
};
