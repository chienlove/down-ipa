package keychain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Keychain struct {
	mu     sync.Mutex
	dbPath string
	data   map[string]string
}

func New(name string) (*Keychain, error) {
	k := &Keychain{
		dbPath: filepath.Join(os.TempDir(), name+".json"),
		data:   map[string]string{},
	}
	_ = k.load()
	return k, nil
}

func (k *Keychain) load() error {
	file, err := os.ReadFile(k.dbPath)
	if err == nil {
		json.Unmarshal(file, &k.data)
	}
	return nil
}

func (k *Keychain) save() error {
	k.mu.Lock()
	defer k.mu.Unlock()
	file, _ := json.Marshal(k.data)
	return os.WriteFile(k.dbPath, file, 0600)
}

func (k *Keychain) Get(service, account string) (string, error) {
	k.load()
	return k.data[service+"|"+account], nil
}

func (k *Keychain) Set(service, account, password string) error {
	k.load()
	k.data[service+"|"+account] = password
	return k.save()
}

func (k *Keychain) Remove(service, account string) error {
	k.load()
	delete(k.data, service+"|"+account)
	return k.save()
}