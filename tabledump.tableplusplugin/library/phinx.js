/* globals Application,SystemService */
'use strict';

import { camelize } from './helper';

/**
 * Main entry point to dumping table definitions as a Phinx migration
 * @param {*} tblPlusContext
 * @param {*} tblPlusCurrentTable
 * @returns void
 */
function dumpTableAsPhinx(tblPlusContext, tblPlusCurrentTable) {
    var nameCamelcase = camelize(tblPlusCurrentTable.name());
    var columns = [];
    var indexes = [];
    var foreignKeys = [];
    var query;
    var indexQuery;
    var fkQuery;
    var driver = tblPlusContext.driver();
    var now = new Date();
    var completedQueries = 0;
    var header;
    // build query to get a columns from the DB
    if (driver !== 'MariaDB' && driver !== 'MySQL') {
        tblPlusContext.alert('Error', driver + ' is not supported');
        return;
    }
    // the header content of the PHP file before the table is defined
    header = `<?php

    declare(strict_types=1);

    use Phinx\\Migration\\AbstractMigration;

    /**
     * Migration auto-generated by TablePlus ${Application.appVersion()}(${Application.appBuild()}) on ${now}
     * @author https://tableplus.com
     * @source https://github.com/TablePlus/tabledump
     */
    final class Create${nameCamelcase} extends AbstractMigration
    {
      /**
       * Process the migration schema changes
       * @return void
       */
      public function change(): void
      {\n`;

    // build query to get a columns from the DB
    switch (driver) {
        case 'MySQL':
        case 'MariaDB':
            query = `SELECT ordinal_position as ordinal_position,column_name as column_name,column_type,is_nullable as is_nullable,column_default as column_default,extra as extra,column_key,column_comment AS comment FROM information_schema.columns WHERE table_schema='${tblPlusCurrentTable.schema()}'AND table_name='${tblPlusCurrentTable.name()}';`;
            break;
        default:
            tblPlusContext.alert('Error', driver + ' is not supported');
            return;
    }

    // get all the columns for the table by querying the DB
    query = `SELECT ordinal_position as ordinal_position,column_name as column_name,column_type,is_nullable as is_nullable,column_default as column_default,extra as extra,column_key,column_comment AS comment FROM information_schema.columns WHERE table_schema='${tblPlusCurrentTable.schema()}'AND table_name='${tblPlusCurrentTable.name()}';`;
    tblPlusContext.execute(query, res => {
        res.rows.sort((l, r) => {
            return (
                parseInt(l.raw('ordinal_position')) >
                parseInt(r.raw('ordinal_position'))
            );
        });
        // parse the results
        res.rows.forEach(row => {
            let columnName = row.raw('column_name');
            columns.push({
                name: columnName,
                type: row.raw('column_type'),
                nullable: row.raw('is_nullable'),
                default: row.raw('column_default'),
                extra: row.raw('extra'),
                comment: row.raw('comment')
            });
        });
        // SystemService.notify('completed column defs');
        completedQueries++;
        if (completedQueries === 3) {
            writeTableDumpToClipboard(columns, indexes, foreignKeys, header, tblPlusCurrentTable);
        }
    });
    // process column indexes
    indexQuery = `SELECT DISTINCT TABLE_SCHEMA as database_name, TABLE_NAME as table_name, INDEX_NAME as index_name, INDEX_TYPE as index_type, NON_UNIQUE as non_unique, GROUP_CONCAT(COLUMN_NAME) AS column_names FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = '${tblPlusCurrentTable.schema()}' AND TABLE_NAME = '${tblPlusCurrentTable.name()}' GROUP BY DATABASE_NAME,TABLE_NAME,INDEX_NAME ORDER BY TABLE_SCHEMA,TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;`;
    tblPlusContext.execute(indexQuery, res => {
        res.rows.forEach(row => {
            indexes.push({
                name: row.raw('index_name'),
                type: row.raw('index_type'),
                nonUnique: row.raw('non_unique'),
                columnNames: row.raw('column_names')
            });
        });
        // SystemService.notify('completed index defs');
        completedQueries++;
        if (completedQueries === 3) {
            writeTableDumpToClipboard(columns, indexes, foreignKeys, header, tblPlusCurrentTable);
        }
    });
    // foreign keys from information_schema
    // TODO support for multiple foreign keys?
    fkQuery = `SELECT RC.CONSTRAINT_CATALOG AS catalog_name, RC.CONSTRAINT_SCHEMA AS database_name, RC.CONSTRAINT_NAME AS name, RC.UPDATE_RULE AS on_update, RC.DELETE_RULE AS on_delete, RC.TABLE_NAME AS table_name, RC.REFERENCED_TABLE_NAME AS ref_table_name, KCU.COLUMN_NAME AS column_name, KCU.REFERENCED_COLUMN_NAME AS ref_column_name, KCU.ORDINAL_POSITION AS ordinal FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS KCU INNER JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS AS RC ON KCU.CONSTRAINT_SCHEMA = RC.CONSTRAINT_SCHEMA AND KCU.CONSTRAINT_NAME = RC.CONSTRAINT_NAME WHERE KCU.TABLE_SCHEMA = '${tblPlusCurrentTable.schema()}' AND KCU.TABLE_NAME = '${tblPlusCurrentTable.name()}' AND RC.CONSTRAINT_SCHEMA = '${tblPlusCurrentTable.schema()}' AND RC.TABLE_NAME = '${tblPlusCurrentTable.name()}' ORDER BY KCU.REFERENCED_TABLE_NAME, KCU.ORDINAL_POSITION;`;
    tblPlusContext.execute(fkQuery, res => {
        res.rows.forEach(row => {
            foreignKeys.push({
                name: row.raw('name'),
                onUpdate: row.raw('on_update'),
                onDelete: row.raw('on_delete'),
                tableName: row.raw('table_name'),
                refTableName: row.raw('ref_table_name'),
                columnName: row.raw('column_name'),
                refColumnName: row.raw('ref_column_name')
            });
        });
        // SystemService.notify('completed foreign key defs');
        completedQueries++;
        if (completedQueries === 3) {
            writeTableDumpToClipboard(columns, indexes, foreignKeys, header, tblPlusCurrentTable);
        }
    });
}

/**
 * Takes an object and converts to a PHP style array, returning a string
 * @param {*} opts
 * @returns string
 */
function buildPhpArrayOptions(opts) {
    var builtOptions = '';
    if (Object.entries(opts).length > 0) {
        builtOptions += ', [';
        var optCount = 1;
        for (const [key, value] of Object.entries(opts)) {
            if (optCount !== 1) {
                builtOptions += ', ';
            }
            builtOptions += "'" + key + "' => " + value;
            optCount++;
        }
        builtOptions += ']';
    }
    return builtOptions;
}

/**
 * Builds a Phinx column definition based on provided params
 * @param {*} columnName
 * @param {*} columnType
 * @param {*} isNullable
 * @param {*} defaultVal
 * @param {*} extra
 * @param {*} columnComment
 * @returns string
 */
function getColumnDefinition(columnName, columnType, isNullable, defaultVal, extra, columnComment) {
    var typeArr = columnType.split('(');
    var typeOnly = typeArr[0];
    var typeLength = '';
    var typeScale = '';
    var typePrecision = '';
    if (typeArr.length > 1) {
        typeLength = typeArr[1].replace(')', '');
        var scalePrecisionArr = typeLength.split(',');
        if (scalePrecisionArr.length > 1) {
            typePrecision = scalePrecisionArr[0];
            typeScale = scalePrecisionArr[1];
        }
    }

    // parse options for the column
    var columnOptions = {};
    if (columnType.includes('unsigned')) {
        columnOptions.signed = 'false';
    }
    typeLength = typeLength.replace(' unsigned', '');
    if (isNullable.toLowerCase().startsWith('y')) {
        columnOptions.null = 'true';
    } else {
        columnOptions.null = 'false';
    }
    if (defaultVal === 'NULL') {
        columnOptions.default = null;
    } else if (parseInt(defaultVal) == defaultVal || parseFloat(defaultVal) == defaultVal) {
        columnOptions.default = defaultVal;
    } else if (defaultVal == 'current_timestamp()' || defaultVal == 'now()') {
        columnOptions.default = "'CURRENT_TIMESTAMP'";
    } else if (typeof (columnOptions.default) != 'undefined') {
        columnOptions.default = "'" + defaultVal + "'";
    }
    if (typeof columnComment != 'undefined' && columnComment) {
        columnOptions.comment = "'" + columnComment.replace(/'/g, "\\'") + "'";
    }
    if (typeLength) {
        columnOptions.length = typeLength;
    }
    if (extra == 'on update current_timestamp()') {
        columnOptions.update = "'CURRENT_TIMESTAMP'";
    }
    // init column def
    var columnDef = "addColumn('" + columnName + "', ";
    // map phinx column type
    var phinxType = '';
    switch (typeOnly) {
        case 'varchar':
            phinxType = 'string';
            break;

        case 'int':
        case 'mediumint':
            phinxType = 'integer';
            break;

        case 'bigint':
            phinxType = 'biginteger';
            break;

        case 'tinyint':
            phinxType = 'tinyinteger';
            break;

        case 'float':
        case 'double':
        case 'decimal':
            phinxType = typeOnly;
            columnOptions.scale = typeScale;
            columnOptions.precision = typePrecision;
            delete columnOptions.length;
            break;

        default:
            phinxType = typeOnly;
            break;
    }
    // add phinx column type
    columnDef += "'" + phinxType + "'";
    // parse column options and output as PHP style array
    let columnOptDefs = buildPhpArrayOptions(columnOptions);
    columnDef += columnOptDefs;
    // close column definition
    columnDef += ')';
    return columnDef;
}

/**
 * Copies the built migration PHP code to the clipboard and sends a system notification in TablePlus
 * @param {*} columns
 * @param {*} indexes
 * @param {*} foreignKeys
 * @param {*} header
 * @param {*} tblPlusCurrentTable
 * @returns void
 */
function writeTableDumpToClipboard(columns, indexes, foreignKeys, header, tblPlusCurrentTable) {
    // TODO check for other primary key(s)
    var defaultIdPrimaryKey = true;
    if (defaultIdPrimaryKey === false) {
        header += `          $this->table('${tblPlusCurrentTable.name()}', ['id' => false, 'primary' => []])\n`;
    } else {
        header += `          $this->table('${tblPlusCurrentTable.name()}')\n`;
    }
    var result = header;
    // SystemService.notify('dumping to clipboard');
    for (let i = 0; i < columns.length; i++) {
        if (i == 0) {
            result += `            \/\/ columns:\n`;
        }
        if (defaultIdPrimaryKey === true && columns[i].name !== 'id') {
            var columnMigrate = getColumnDefinition(
                columns[i].name,
                columns[i].type,
                columns[i].nullable,
                columns[i].default,
                columns[i].extra,
                columns[i].comment
            );
            if (columnMigrate != null) {
                result += `            ->${columnMigrate}\n`;
            } else {
                // if column migrate returns null for any reason it did not work so add comment to our migration class instead
                result += `            \/\/ ${columns[i].name}\n`;
            }
        }
    }

    // write indexes to the migration class
    for (let i = 0; i < indexes.length; i++) {
        if (i == 0) {
            result += `            \/\/ indexes:\n`;
        }
        if (indexes[i].name === 'PRIMARY') {
            // TODO primary key support
        } else {
            let indexColumns = indexes[i].columnNames.replace(',', "', '");
            let indexOptions = {};
            if (parseInt(indexes[i].nonUnique) == 0) {
                indexOptions.unique = 'true';
            }
            indexOptions.name = "'" + indexes[i].name + "'";
            // parse column options and output as PHP style array
            let indexOptDef = buildPhpArrayOptions(indexOptions);
            result += `            ->addIndex(['${indexColumns}']${indexOptDef})\n`;
        }
    }

    // write foreign key associations to the migration class
    for (let i = 0; i < foreignKeys.length; i++) {
        if (i == 0) {
            result += `            \/\/ foreign keys:\n`;
        }
        let fkOptions = {};
        if (typeof (foreignKeys[i].onUpdate) == 'string') {
            fkOptions.update = "'" + foreignKeys[i].onUpdate.toUpperCase().replace(' ', '_') + "'";
        }
        if (typeof (foreignKeys[i].onDelete) == 'string') {
            fkOptions.delete = "'" + foreignKeys[i].onDelete.toUpperCase().replace(' ', '_') + "'";
        }
        let fkOptDef = buildPhpArrayOptions(fkOptions);
        result += `            ->addForeignKeyWithName('${foreignKeys[i].name}', '${foreignKeys[i].columnName}', '${foreignKeys[i].refTableName}', '${foreignKeys[i].refColumnName}'${fkOptDef})\n`;
    }

    // append the PHP footer code to the output to complete the migration class
    result += `            \/\/ commit changes:\n`;
    result += `            ->create();\n`;
    result += `         }\n`;
    result += `    }\n`;
    // copy result to clipboard and notify user
    SystemService.insertToClipboard(result);
    SystemService.notify(
        'Phinx export',
        tblPlusCurrentTable.type() + ' ' + tblPlusCurrentTable.name() + ' migration code is copied!'
    );
}

export { dumpTableAsPhinx };
