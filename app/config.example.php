<?php
/* Example only. The real app/config.php is written by install.php and must never be committed:
   it holds the database password and the app key (which encrypts two-step verification secrets). */
return array (
  'db_host' => 'localhost', 'db_port' => 3306,
  'db_name' => 'your_database', 'db_user' => 'your_db_user', 'db_pass' => 'CHANGE-ME',
  'storage_path' => '/home/youraccount/km_storage',   // outside public_html
  'timezone' => 'Africa/Nairobi', 'debug' => false,
  'app_key' => 'GENERATED-BY-INSTALLER',
);
