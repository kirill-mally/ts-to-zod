import ts from "typescript";

export interface SimplifiedJSDocTag {
  /**
   * Name of the tag
   *
   * @ref tag.tagName.escapedText.toString()
   */
  name: string;

  /**
   * Value of the tag
   *
   * @ref tag.comment
   */
  value?: string;
}

export type GetSchemaName = (identifier: string) => string;
export type NameFilter = (name: string) => boolean;
export type JSDocTagFilter = (tags: SimplifiedJSDocTag[]) => boolean;

/**
 * @example
 *  {
 *    regex: "^\\d{4}-\\d{2}-\\d{2}$",
 *    errorMessage: "Must be in YYYY-MM-DD format."
 *  }
 */
export type CustomJSDocFormatTypeAttributes = {
  regex: string;
  errorMessage?: string;
};

export type CustomJSDocFormatType = string;

/**
 * @example
 *  {
 *    "phone-number": "^\\d{3}-\\d{3}-\\d{4}$",
 *    date: {
 *      regex: "^\\d{4}-\\d{2}-\\d{2}$",
 *      errorMessage: "Must be in YYYY-MM-DD format."
 *    }
 * }
 */
export type CustomJSDocFormatTypes = Record<
  CustomJSDocFormatType,
  string | CustomJSDocFormatTypeAttributes
>;

export interface MaybeConfig {
  optional: boolean;
  nullable: boolean;
  typeNames: Set<string>; // Names of generic interfaces to treat as Maybe<T>
}

export interface State {
  // existing fields...
  genericMap: Map<string, ts.TypeNode>;
  maybeConfig: MaybeConfig;
  rawFileAst: ts.SourceFile | undefined;
  seenSymbols: Set<ts.Symbol>;
}

export const DefaultMaybeConfig: MaybeConfig = {
  typeNames: new Set([]),
  optional: true,
  nullable: true,
};

export type Config = {
  /**
   * Path of the input file (types source)
   */
  input: string;

  /**
   * Path of the output file (generated zod schemas)
   */
  output: string;

  /**
   * Skip the validation step (not recommended)
   */
  skipValidation?: boolean;

  /**
   * Filter on type/interface name.
   */
  nameFilter?: NameFilter;

  /**
   * Filter on JSDocTag.
   */
  jsDocTagFilter?: JSDocTagFilter;

  /**
   * Schema name generator.
   */
  getSchemaName?: GetSchemaName;

  /**
   * Keep parameters comments.
   * @default false
   */
  keepComments?: boolean;

  /**
   * Skip the creation of zod validators from JSDoc annotations
   *
   * @default false
   */
  skipParseJSDoc?: boolean;

  /**
   * Path of z.infer<> types file.
   */
  inferredTypes?: string;

  /**
   * A record of custom `@format` types with their corresponding regex patterns.
   */
  customJSDocFormatTypes?: CustomJSDocFormatTypes;

  /*
   * If present, it will enable the Maybe special case for each of the given type names.
   * They can be names of interfaces or types.
   *
   * e.g.
   * - maybeTypeNames: ["Maybe"]
   * - maybeOptional: true
   * - maybeNullable: true
   *
   * ```ts
   * // input:
   * export type X = { a: string; b: Maybe<string> };
   *
   * // output:
   * const maybe = <T extends z.ZodTypeAny>(schema: T) => {
   *   return schema.optional().nullable();
   * };
   *
   * export const xSchema = zod.object({
   *   a: zod.string(),
   *   b: maybe(zod.string())
   * })
   * ```
   */
  maybeTypeNames?: string[];

  /**
   * determines if the Maybe special case is optional (can be treated as undefined) or not
   *
   * @see maybeTypeNames
   * @default true
   */
  maybeOptional?: boolean;

  /**
   * determines if the Maybe special case is nullable (can be treated as null) or not
   *
   * @see maybeTypeNames
   * @default true
   */
  maybeNullable?: boolean;
};

export type Configs = Array<
  Config & {
    /**
     * Name of the config.
     *
     * Usage: `ts-to-zod --config {name}`
     */
    name: string;
  }
>;

export type InputOutputMapping = Pick<
  Config,
  "input" | "output" | "getSchemaName"
>;

export type TsToZodConfig = Config | Configs;
