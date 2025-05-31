package keychain

import (
	"encoding/json"
	"fmt"
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
		data:   make(map[string]string),
	}
	_ = k.load()
	return k, nil
}

func (k *Keychain) load() error {
	k.mu.Lock()
	defer k.mu.Unlock()

	content, err := os.ReadFile(k.dbPath)
	if err != nil {
		// file not found is okay
		return nil
	}
	return json.Unmarshal(content, &k.data)
}

func (k *Keychain) save() error {
	k.mu.Lock()
	defer k.mu.Unlock()

	content, err := json.MarshalIndent(k.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(k.dbPath, content, 0600)
}

func makeKey(service, account string) string {
	return fmt.Sprintf("%s|%s", service, account)
}

func (k *Keychain) Get(service, account string) (string, error) {
	k.load()
	val, ok := k.data[makeKey(service, account)]
	if !ok {
		return "", fmt.Errorf("no value found")
	}
	return val, nil
}

func (k *Keychain) Set(service, account, password string) error {
	k.load()
	k.data[makeKey(service, account)] = password
	return k.save()
}

func (k *Keychain) Remove(service, account string) error {
	k.load()
	delete(k.data, makeKey(service, account))
	return k.save()
}