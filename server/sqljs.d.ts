
declare module 'sql.js' {
  export interface SqlValue {}
  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }
  export interface Statement {
    bind(values?: unknown[]): boolean;
    step(): boolean;
    getAsObject(params?: object): Record<string, unknown>;
    free(): boolean;
  }
  export interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }
  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
