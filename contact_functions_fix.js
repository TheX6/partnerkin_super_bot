// Исправленные функции редактирования и удаления контактов с улучшенной безопасностью

// Вспомогательные функции валидации
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidPhone(phone) {
    const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
    return phoneRegex.test(phone);
}

// Исправленная функция startEditContact
function startEditContact(chatId, telegramId) {
    try {
        // Сброс предыдущего состояния
        if (global.userScreenshots[telegramId]) {
            delete global.userScreenshots[telegramId];
        }
        
        // Проверка прав администратора
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (err || !admin) {
                console.log(`[SECURITY] Unauthorized access attempt to edit contacts by user ${telegramId}`);
                bot.sendMessage(chatId, '❌ У вас нет прав для выполнения этой операции.').catch(console.error);
                return;
            }
            
            db.all(`SELECT cc.*, u.role as added_by_role
                    FROM company_contacts cc
                    LEFT JOIN users u ON cc.added_by = u.id
                    ORDER BY cc.company_name, cc.contact_name`, (err, contacts) => {
                if (err) {
                    console.error('Error fetching contacts for editing:', err);
                    bot.sendMessage(chatId, '❌ Ошибка при получении списка контактов!').catch(console.error);
                    return;
                }

                if (!contacts || contacts.length === 0) {
                    bot.sendMessage(chatId,
                        '📭 В базе данных нет контактов для редактирования.\n\n' +
                        'Сначала добавьте контакт через "➕ Добавить контакт"').catch(console.error);
                    return;
                }

                // Сохранение контактов для выбора
                global.userScreenshots[telegramId] = {
                    type: 'contact_editing',
                    step: 'select_contact',
                    contacts: contacts,
                    data: {}
                };

                let contactsText = '🔍 Выберите контакт для редактирования:\n\n';
                
                let currentCompany = '';
                contacts.forEach((contact, index) => {
                    if (contact.company_name !== currentCompany) {
                        currentCompany = contact.company_name;
                        contactsText += `🏢 ${contact.company_name}\n`;
                    }

                    contactsText += `${index + 1}. ${contact.contact_name}`;
                    if (contact.position) contactsText += ` (${contact.position})`;
                    contactsText += '\n';
                });

                contactsText += '\n💡 Введите номер контакта для редактирования (1-' + contacts.length + ') или "отмена" для выхода:';

                bot.sendMessage(chatId, contactsText).catch(console.error);
                
                // Логирование операции
                console.log(`[CONTACT EDIT] Admin ${telegramId} started contact editing process`);
            });
        });
    } catch (error) {
        console.error('Error in startEditContact:', error);
    }
}

// Исправленная функция startDeleteContact
function startDeleteContact(chatId, telegramId) {
    try {
        // Сброс предыдущего состояния
        if (global.userScreenshots[telegramId]) {
            delete global.userScreenshots[telegramId];
        }
        
        // Проверка прав администратора
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (err || !admin) {
                console.log(`[SECURITY] Unauthorized access attempt to delete contacts by user ${telegramId}`);
                bot.sendMessage(chatId, '❌ У вас нет прав для выполнения этой операции.').catch(console.error);
                return;
            }
            
            db.all(`SELECT cc.*, u.role as added_by_role
                    FROM company_contacts cc
                    LEFT JOIN users u ON cc.added_by = u.id
                    ORDER BY cc.company_name, cc.contact_name`, (err, contacts) => {
                if (err) {
                    console.error('Error fetching contacts for deletion:', err);
                    bot.sendMessage(chatId, '❌ Ошибка при получении списка контактов!').catch(console.error);
                    return;
                }

                if (!contacts || contacts.length === 0) {
                    bot.sendMessage(chatId,
                        '📭 В базе данных нет контактов для удаления.\n\n' +
                        'Сначала добавьте контакт через "➕ Добавить контакт"').catch(console.error);
                    return;
                }

                // Сохранение контактов для выбора
                global.userScreenshots[telegramId] = {
                    type: 'contact_deletion',
                    step: 'select_contact',
                    contacts: contacts,
                    data: {}
                };

                let contactsText = '🗑️ Выберите контакт для удаления:\n\n';
                
                let currentCompany = '';
                contacts.forEach((contact, index) => {
                    if (contact.company_name !== currentCompany) {
                        currentCompany = contact.company_name;
                        contactsText += `🏢 ${contact.company_name}\n`;
                    }

                    contactsText += `${index + 1}. ${contact.contact_name}`;
                    if (contact.position) contactsText += ` (${contact.position})`;
                    contactsText += '\n';
                });

                contactsText += '\n⚠️ Введите номер контакта для удаления (1-' + contacts.length + ') или "отмена" для выхода:';

                bot.sendMessage(chatId, contactsText).catch(console.error);
                
                // Логирование операции
                console.log(`[CONTACT DELETE] Admin ${telegramId} started contact deletion process`);
            });
        });
    } catch (error) {
        console.error('Error in startDeleteContact:', error);
    }
}

// Исправленная функция handleContactEditing
function handleContactEditing(chatId, telegramId, text) {
    try {
        const contactData = global.userScreenshots[telegramId];
        
        if (contactData.step === 'select_contact') {
            const contactIndex = parseInt(text.trim()) - 1;
            
            if (isNaN(contactIndex) || contactIndex < 0 || contactIndex >= contactData.contacts.length) {
                if (text.toLowerCase() === 'отмена') {
                    delete global.userScreenshots[telegramId];
                    bot.sendMessage(chatId, '❌ Редактирование контакта отменено').catch(console.error);
                    return;
                }
                bot.sendMessage(chatId, '❌ Неверный номер контакта. Попробуйте еще раз или введите "отмена":').catch(console.error);
                return;
            }
            
            const selectedContact = contactData.contacts[contactIndex];
            contactData.selectedContact = selectedContact;
            contactData.step = 'select_field';
            
            let contactInfo = `📝 Редактирование контакта:\n\n`;
            contactInfo += `🏢 Компания: ${selectedContact.company_name}\n`;
            contactInfo += `👤 Имя контакта: ${selectedContact.contact_name}\n`;
            if (selectedContact.position) contactInfo += `💼 Должность: ${selectedContact.position}\n`;
            if (selectedContact.email) contactInfo += `📧 Email: ${selectedContact.email}\n`;
            if (selectedContact.phone) contactInfo += `📞 Телефон: ${selectedContact.phone}\n`;
            if (selectedContact.telegram) contactInfo += `👤 Telegram: ${selectedContact.telegram}\n`;
            if (selectedContact.notes) contactInfo += `📝 Примечания: ${selectedContact.notes}\n`;
            
            contactInfo += `\nВыберите поле для редактирования:\n`;
            contactInfo += `1. 🏢 Компания\n`;
            contactInfo += `2. 👤 Имя контакта\n`;
            contactInfo += `3. 💼 Должность\n`;
            contactInfo += `4. 📧 Email\n`;
            contactInfo += `5. 📞 Телефон\n`;
            contactInfo += `6. 👤 Telegram\n`;
            contactInfo += `7. 📝 Примечания\n`;
            contactInfo += `\nВведите номер поля (1-7) или "отмена" для выхода:`;
            
            bot.sendMessage(chatId, contactInfo).catch(console.error);
            
        } else if (contactData.step === 'select_field') {
            const fieldIndex = parseInt(text.trim());
            
            if (isNaN(fieldIndex) || fieldIndex < 1 || fieldIndex > 7) {
                if (text.toLowerCase() === 'отмена') {
                    delete global.userScreenshots[telegramId];
                    bot.sendMessage(chatId, '❌ Редактирование контакта отменено').catch(console.error);
                    return;
                }
                bot.sendMessage(chatId, '❌ Неверный номер поля. Попробуйте еще раз или введите "отмена":').catch(console.error);
                return;
            }
            
            const fieldNames = {
                1: 'компанию',
                2: 'имя контакта',
                3: 'должность',
                4: 'email',
                5: 'телефон',
                6: 'telegram',
                7: 'примечания'
            };
            
            // Использование whitelist для полей
            const allowedFields = {
                1: 'company_name',
                2: 'contact_name',
                3: 'position',
                4: 'email',
                5: 'phone',
                6: 'telegram',
                7: 'notes'
            };
            
            contactData.selectedField = allowedFields[fieldIndex];
            contactData.step = 'enter_value';
            
            const currentValue = contactData.selectedContact[contactData.selectedField];
            bot.sendMessage(chatId,
                `✏️ Редактирование поля "${fieldNames[fieldIndex]}"\n\n` +
                `Текущее значение: ${currentValue || '(не указано)'}\n\n` +
                `Введите новое значение или "отмена" для выхода:`
            ).catch(console.error);
            
        } else if (contactData.step === 'enter_value') {
            if (text.toLowerCase() === 'отмена') {
                delete global.userScreenshots[telegramId];
                bot.sendMessage(chatId, '❌ Редактирование контакта отменено').catch(console.error);
                return;
            }
            
            const newValue = text.trim();
            const contactId = contactData.selectedContact.id;
            const field = contactData.selectedField;
            
            // Валидация данных
            if (field === 'email' && newValue && !isValidEmail(newValue)) {
                bot.sendMessage(chatId, '❌ Введен некорректный email. Пожалуйста, попробуйте еще раз:').catch(console.error);
                return;
            }
            
            if (field === 'phone' && newValue && !isValidPhone(newValue)) {
                bot.sendMessage(chatId, '❌ Введен некорректный номер телефона. Пожалуйста, попробуйте еще раз:').catch(console.error);
                return;
            }
            
            // Проверка безопасности поля
            const allowedFields = ['company_name', 'contact_name', 'position', 'email', 'phone', 'telegram', 'notes'];
            if (!allowedFields.includes(field)) {
                console.error(`[SECURITY] Attempt to update forbidden field: ${field} by admin ${telegramId}`);
                delete global.userScreenshots[telegramId];
                bot.sendMessage(chatId, '❌ Попытка обновления запрещенного поля!').catch(console.error);
                return;
            }
            
            db.run(`UPDATE company_contacts SET ${field} = ? WHERE id = ?`, [newValue, contactId], function(err) {
                if (err) {
                    console.error('Error updating contact:', err);
                    bot.sendMessage(chatId, '❌ Ошибка при обновлении контакта!').catch(console.error);
                    return;
                }
                
                // Логирование операции
                console.log(`[CONTACT EDIT] Admin ${telegramId} updated contact ${contactId}: ${field} = "${newValue}"`);
                
                delete global.userScreenshots[telegramId];
                
                bot.sendMessage(chatId,
                    `✅ Контакт успешно обновлен!\n\n` +
                    `🏢 Компания: ${contactData.selectedContact.company_name}\n` +
                    `👤 Имя контакта: ${contactData.selectedContact.contact_name}\n` +
                    `📝 Обновленное поле: ${field}\n` +
                    `🔤 Новое значение: ${newValue}`
                ).catch(console.error);
            });
        }
    } catch (error) {
        console.error('Error in handleContactEditing:', error);
        delete global.userScreenshots[telegramId];
    }
}

// Исправленная функция handleContactDeletion
function handleContactDeletion(chatId, telegramId, text) {
    try {
        const contactData = global.userScreenshots[telegramId];
        
        if (contactData.step === 'select_contact') {
            const contactIndex = parseInt(text.trim()) - 1;
            
            if (isNaN(contactIndex) || contactIndex < 0 || contactIndex >= contactData.contacts.length) {
                if (text.toLowerCase() === 'отмена') {
                    delete global.userScreenshots[telegramId];
                    bot.sendMessage(chatId, '❌ Удаление контакта отменено').catch(console.error);
                    return;
                }
                bot.sendMessage(chatId, '❌ Неверный номер контакта. Попробуйте еще раз или введите "отмена":').catch(console.error);
                return;
            }
            
            const selectedContact = contactData.contacts[contactIndex];
            contactData.selectedContact = selectedContact;
            contactData.step = 'confirm_deletion';
            
            let contactInfo = `⚠️ Подтверждение удаления контакта:\n\n`;
            contactInfo += `🏢 Компания: ${selectedContact.company_name}\n`;
            contactInfo += `👤 Имя контакта: ${selectedContact.contact_name}\n`;
            if (selectedContact.position) contactInfo += `💼 Должность: ${selectedContact.position}\n`;
            if (selectedContact.email) contactInfo += `📧 Email: ${selectedContact.email}\n`;
            if (selectedContact.phone) contactInfo += `📞 Телефон: ${selectedContact.phone}\n`;
            if (selectedContact.telegram) contactInfo += `👤 Telegram: ${selectedContact.telegram}\n`;
            if (selectedContact.notes) contactInfo += `📝 Примечания: ${selectedContact.notes}\n`;
            
            contactInfo += `\n⚠️ ВНИМАНИЕ! Это действие необратимо!\n\n`;
            contactInfo += `Для подтверждения удаления введите "да" или "удалить"\n`;
            contactInfo += `Для отмены введите "отмена"`;
            
            bot.sendMessage(chatId, contactInfo).catch(console.error);
            
        } else if (contactData.step === 'confirm_deletion') {
            const confirmation = text.toLowerCase().trim();
            
            if (confirmation === 'да' || confirmation === 'удалить') {
                const contactId = contactData.selectedContact.id;
                
                db.run(`DELETE FROM company_contacts WHERE id = ?`, [contactId], function(err) {
                    if (err) {
                        console.error('Error deleting contact:', err);
                        bot.sendMessage(chatId, '❌ Ошибка при удалении контакта!').catch(console.error);
                        return;
                    }
                    
                    // Логирование операции
                    console.log(`[CONTACT DELETE] Admin ${telegramId} deleted contact ${contactId}: ${contactData.selectedContact.company_name} - ${contactData.selectedContact.contact_name}`);
                    
                    delete global.userScreenshots[telegramId];
                    
                    bot.sendMessage(chatId,
                        `✅ Контакт успешно удален!\n\n` +
                        `🏢 Компания: ${contactData.selectedContact.company_name}\n` +
                        `👤 Имя контакта: ${contactData.selectedContact.contact_name}`
                    ).catch(console.error);
                });
            } else if (confirmation === 'отмена') {
                delete global.userScreenshots[telegramId];
                bot.sendMessage(chatId, '❌ Удаление контакта отменено').catch(console.error);
            } else {
                bot.sendMessage(chatId, '❌ Неверное подтверждение. Введите "да", "удалить" или "отмена":').catch(console.error);
            }
        }
    } catch (error) {
        console.error('Error in handleContactDeletion:', error);
        delete global.userScreenshots[telegramId];
    }
}