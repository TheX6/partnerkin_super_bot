// transfer_files.js - Скрипт для копирования файлов в папку тапалки

const fs = require('fs');
const path = require('path');

// Пути к файлам в текущей директории
const sourceFiles = {
    database: path.join(__dirname, 'database.js'),
    config: path.join(__dirname, 'config.js')
};

// Путь к папке тапалки
const targetDir = '/home/oleg/partnerkino-clicker-temp';

// Копируем файлы
function copyFiles() {
    console.log('Копирование файлов в папку тапалки...');
    
    try {
        // Копируем database.js
        if (fs.existsSync(sourceFiles.database)) {
            const sourceDatabase = fs.readFileSync(sourceFiles.database, 'utf8');
            // Обновляем файл для тапалки (удаляем зависимости, специфичные для основного бота)
            const databaseForClicker = sourceDatabase.replace(
                /const config = require\('\.\/config'\);/,
                `const config = require('./config');`
            );
            fs.writeFileSync(path.join(targetDir, 'database.js'), databaseForClicker);
            console.log('✅ database.js скопирован');
        } else {
            console.error('❌ Файл database.js не найден в исходной директории');
        }
        
        // Копируем config.js
        if (fs.existsSync(sourceFiles.config)) {
            const sourceConfig = fs.readFileSync(sourceFiles.config, 'utf8');
            fs.writeFileSync(path.join(targetDir, 'config.js'), sourceConfig);
            console.log('✅ config.js скопирован');
        } else {
            console.error('❌ Файл config.js не найден в исходной директории');
        }
        
        // Обновляем package.json для добавления pg
        const packageJsonPath = path.join(targetDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            packageJson.dependencies = packageJson.dependencies || {};
            if (!packageJson.dependencies.pg) {
                packageJson.dependencies.pg = "^8.11.3";
                packageJson.dependencies.dotenv = "^16.6.1";
            }
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
            console.log('✅ package.json обновлен');
        } else {
            console.error('❌ package.json не найден в папке тапалки');
        }
        
        console.log('\n📁 Все файлы успешно скопированы в папку тапалки!');
        console.log('\n⚠️  Необходимо обновить clicker-app.js для использования нового модуля базы данных.');
        console.log('   Также убедитесь, что в Render заданы правильные переменные окружения для PostgreSQL.');
        
    } catch (error) {
        console.error('❌ Ошибка при копировании файлов:', error);
    }
}

copyFiles();